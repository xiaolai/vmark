//! Workspace-keyed lifecycle registry for spawned content servers (WI-1.2).
//!
//! `ContentServerManager` keeps one running server per workspace with a
//! monotonic generation id so a stale shutdown cannot tear down a newer server
//! for the same workspace (review D2.2, mirroring the MCP bridge generation
//! counter). It owns the spawned `Child` processes so shutdown — and the `Drop`
//! on app exit — can terminate them, and exposes `poll_current_child` for the
//! supervisor monitor in `supervisor.rs`.
//!
//! The mutex is held only to DECIDE. Every method that removes a record hands
//! it back as a `cleanup::Detached` (or cleans it up itself after releasing
//! the lock), because killing and reaping a child under the registry lock let
//! one slow reap block every other workspace's status, stop, start and
//! supervisor poll (audit 20260907 #121). A child a teardown could not stop
//! is kept as an orphan rather than forgotten (`retain_orphan`, #122); the
//! orphans, `shutdown_all` and `Drop` live in `manager_teardown.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

use super::cleanup::Detached;

/// A running content server for one workspace (metadata clone for queries).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunningServer {
    pub workspace_root: String,
    pub port: u16,
    pub generation: u64,
    /// The workspace trust the child was spawned with (`--trusted`), which its
    /// CSP enforces for the rest of its life — a start with the other value
    /// must restart it (WI-FL3.6).
    pub trusted: bool,
}

/// Liveness of the managed child for a given (workspace, generation), as
/// observed by the supervisor monitor (WI-1.2, ADR-10).
#[derive(Debug, PartialEq, Eq)]
pub enum ChildState {
    /// No current registration for this (root, generation) — intentional stop
    /// or a newer generation replaced it. The monitor should exit quietly.
    NotCurrent,
    /// The child is still alive.
    Running,
    /// The child exited (crash) with the given code. The manager has already
    /// removed the registration and cleaned up the port-file.
    Exited(Option<i32>),
}

/// Outcome of `register_or_existing`.
#[derive(Debug)]
pub enum RegisterOutcome {
    /// The child was registered as the current server for the root — either
    /// the root was free, or the server already there enforced the OTHER
    /// trust value and was replaced (killed + reaped) by this one (#120).
    Registered,
    /// A concurrent start already won with the SAME trust: its server is
    /// returned, and the child handed in was killed + reaped.
    Existing(RunningServer),
    /// `shutdown_all` already ran (quit in progress): nothing was registered,
    /// and the child handed in was killed + reaped.
    ShuttingDown,
}

/// Internal record: metadata + the spawned child + bootstrap token + port-file.
pub(super) struct Managed {
    pub(super) server: RunningServer,
    pub(super) token: String,
    pub(super) child: Option<Child>,
    pub(super) port_file: Option<PathBuf>,
    /// Consecutive `try_wait` failures observed by `poll_current_child`.
    pub(super) poll_failures: u32,
}

impl Managed {
    pub(super) fn detach(self) -> Detached {
        Detached {
            child: self.child,
            port_file: self.port_file,
        }
    }
}

/// Tracks one server per workspace, keyed by root, with monotonic generations.
/// Owns the spawned child processes so shutdown can terminate them.
#[derive(Default)]
pub struct ContentServerManager {
    inner: Mutex<ManagerState>,
}

#[derive(Default)]
pub(super) struct ManagerState {
    pub(super) servers: HashMap<String, Managed>,
    pub(super) next_generation: u64,
    /// Set (permanently) by `shutdown_all`: registration afterwards is
    /// rejected so an in-flight spawn cannot orphan a child at exit.
    pub(super) shutting_down: bool,
    /// Children a teardown could not stop or reap without proof they are
    /// gone (#122, `ChildFailure::retains_handle`), keyed by root: no longer
    /// servers, still this app's processes. `shutdown_all` tries each once
    /// more at quit.
    pub(super) orphans: Vec<(String, Child)>,
}

impl ManagerState {
    fn insert(
        &mut self,
        root: &str,
        port: u16,
        token: String,
        child: Child,
        pf: PathBuf,
        trusted: bool,
    ) {
        self.next_generation += 1;
        let generation = self.next_generation;
        self.servers.insert(
            root.to_string(),
            Managed {
                server: RunningServer {
                    workspace_root: root.to_string(),
                    port,
                    generation,
                    trusted,
                },
                token,
                child: Some(child),
                port_file: Some(pf),
                poll_failures: 0,
            },
        );
    }
}

#[path = "manager_poll.rs"]
mod poll;
#[path = "manager_teardown.rs"]
mod teardown;

impl ContentServerManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub(super) fn state(&self) -> std::sync::MutexGuard<'_, ManagerState> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Look up the running server metadata for a workspace.
    pub fn get(&self, workspace_root: &str) -> Option<RunningServer> {
        self.state()
            .servers
            .get(workspace_root)
            .map(|m| m.server.clone())
    }

    /// The server AND its token from ONE lock acquisition. Reading them in
    /// two calls let a restart in between pair the old port with the new
    /// token — and send that token to whatever listens on the old port (#128).
    pub fn server_and_token(&self, workspace_root: &str) -> Option<(RunningServer, String)> {
        self.state()
            .servers
            .get(workspace_root)
            .map(|m| (m.server.clone(), m.token.clone()))
    }

    /// Atomically register a freshly-spawned server UNLESS one already exists
    /// for the root with the same trust (a concurrent-start race winner) or
    /// the manager is shutting down. A resident server with the OTHER trust
    /// value is replaced: it enforces the wrong CSP, and returning it would
    /// hand the caller a server it must immediately restart (#120). Whichever
    /// child loses — the one handed in, or the one replaced — is killed +
    /// reaped here AFTER the lock is released (std::process::Child does NOT
    /// kill on drop), or kept as an orphan if it could not be (#122);
    /// port-file cleanup for the handed-in child stays the caller's job.
    pub fn register_or_existing(
        &self,
        workspace_root: &str,
        port: u16,
        token: String,
        child: Child,
        port_file: PathBuf,
        trusted: bool,
    ) -> RegisterOutcome {
        let (outcome, loser) = {
            let mut state = self.state();
            if state.shutting_down {
                // Shutdown already drained the map; registering now would
                // orphan this child at exit (nothing would ever kill it again).
                (
                    RegisterOutcome::ShuttingDown,
                    Some(Detached::child_only(child)),
                )
            } else if let Some(m) = state.servers.get(workspace_root) {
                if m.server.trusted == trusted {
                    // A concurrent start already won — the handed-in child loses.
                    (
                        RegisterOutcome::Existing(m.server.clone()),
                        Some(Detached::child_only(child)),
                    )
                } else {
                    log::info!(
                        "[content-server {workspace_root}] replacing the running server: its trust ({}) is not the requested {trusted}",
                        m.server.trusted
                    );
                    let mut displaced = state.servers.remove(workspace_root).map(Managed::detach);
                    // Both records name the same port-file path; it belongs
                    // to the newcomer now.
                    if let Some(d) = displaced.as_mut() {
                        if d.port_file.as_deref() == Some(port_file.as_path()) {
                            d.port_file = None;
                        }
                    }
                    state.insert(workspace_root, port, token, child, port_file, trusted);
                    (RegisterOutcome::Registered, displaced)
                }
            } else {
                state.insert(workspace_root, port, token, child, port_file, trusted);
                (RegisterOutcome::Registered, None)
            }
        };
        if let Some(loser) = loser {
            self.retain_orphan(workspace_root, loser.cleanup(workspace_root));
        }
        outcome
    }

    /// Remove a workspace's record and return it for cleanup.
    pub fn take(&self, workspace_root: &str) -> Option<Detached> {
        self.state()
            .servers
            .remove(workspace_root)
            .map(Managed::detach)
    }

    /// Remove a workspace's record ONLY if it is still the generation the
    /// caller observed. A `get` followed by `take` let another start replace
    /// the server in between, and the stop then killed the newer one (#116).
    pub fn take_if_generation(&self, workspace_root: &str, generation: u64) -> Option<Detached> {
        let mut state = self.state();
        match state.servers.get(workspace_root) {
            Some(m) if m.server.generation == generation => {
                state.servers.remove(workspace_root).map(Managed::detach)
            }
            _ => None,
        }
    }
}

// Tests live in a sibling file (test-suffixed, so exempt from the file-size
// gate) but remain a child of this module, so `use super::*` resolves manager
// items; the test-support `impl ContentServerManager` lives there too.
#[cfg(test)]
#[path = "manager.test.rs"]
mod tests;
