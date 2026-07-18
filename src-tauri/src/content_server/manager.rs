//! Workspace-keyed lifecycle registry for spawned content servers (WI-1.2).
//!
//! `ContentServerManager` keeps one running server per workspace with a
//! monotonic generation id so a stale shutdown cannot tear down a newer server
//! for the same workspace (review D2.2, mirroring the MCP bridge generation
//! counter). It owns the spawned `Child` processes so shutdown — and the `Drop`
//! on app exit — can terminate them, and exposes `poll_current_child` for the
//! supervisor monitor in `spawn.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

/// A running content server for one workspace (metadata clone for queries).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunningServer {
    pub workspace_root: String,
    pub port: u16,
    pub generation: u64,
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
    /// The child was registered as the current server for the root.
    Registered,
    /// A concurrent start already won: its server is returned, and the child
    /// handed in was killed + reaped.
    Existing(RunningServer),
    /// `shutdown_all` already ran (quit in progress): nothing was registered,
    /// and the child handed in was killed + reaped.
    ShuttingDown,
}

/// Consecutive `Child::try_wait` failures after which the child is treated as
/// dead — a permanently un-pollable child would otherwise leave a stale
/// registration + port file behind forever.
const MAX_POLL_FAILURES: u32 = 3;

/// Internal record: metadata + the spawned child + bootstrap token + port-file.
struct Managed {
    server: RunningServer,
    token: String,
    child: Option<Child>,
    port_file: Option<PathBuf>,
    /// Consecutive `try_wait` failures observed by `poll_current_child`.
    poll_failures: u32,
}

/// Tracks one server per workspace, keyed by root, with monotonic generations.
/// Owns the spawned child processes so shutdown can terminate them.
#[derive(Default)]
pub struct ContentServerManager {
    inner: Mutex<ManagerState>,
}

#[derive(Default)]
struct ManagerState {
    servers: HashMap<String, Managed>,
    next_generation: u64,
    /// Set (permanently) by `shutdown_all`: registration afterwards is
    /// rejected so an in-flight spawn cannot orphan a child at exit.
    shutting_down: bool,
}

impl ContentServerManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Look up the running server metadata for a workspace.
    pub fn get(&self, workspace_root: &str) -> Option<RunningServer> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .servers
            .get(workspace_root)
            .map(|m| m.server.clone())
    }

    /// The bootstrap token for a workspace's server (for nonce minting).
    pub fn token(&self, workspace_root: &str) -> Option<String> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .servers
            .get(workspace_root)
            .map(|m| m.token.clone())
    }

    /// Atomically register a freshly-spawned server UNLESS one already exists
    /// for the root (a concurrent-start race winner) or the manager is
    /// shutting down. In both non-`Registered` outcomes the handed-in child is
    /// killed + reaped here (std::process::Child does NOT kill on drop), so
    /// the caller never orphans a process; port-file cleanup stays the
    /// caller's job.
    pub fn register_or_existing(
        &self,
        workspace_root: &str,
        port: u16,
        token: String,
        mut child: Child,
        port_file: PathBuf,
    ) -> RegisterOutcome {
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if state.shutting_down {
            // Shutdown already drained the map; registering now would orphan
            // this child at exit (nothing would ever kill it again).
            let _ = child.kill();
            let _ = child.wait();
            return RegisterOutcome::ShuttingDown;
        }
        if let Some(m) = state.servers.get(workspace_root) {
            // A concurrent start already won — kill the child we were handed.
            let _ = child.kill();
            let _ = child.wait();
            return RegisterOutcome::Existing(m.server.clone());
        }
        state.next_generation += 1;
        let generation = state.next_generation;
        state.servers.insert(
            workspace_root.to_string(),
            Managed {
                server: RunningServer {
                    workspace_root: workspace_root.to_string(),
                    port,
                    generation,
                },
                token,
                child: Some(child),
                port_file: Some(port_file),
                poll_failures: 0,
            },
        );
        RegisterOutcome::Registered
    }

    /// Poll the managed child for a (root, generation) without blocking. On an
    /// unexpected exit the registration is removed and its port-file deleted, so
    /// the supervisor can surface the crash exactly once. A `take()`/stop that
    /// already removed the entry reports `NotCurrent` (no false crash signal).
    /// `try_wait` failures are counted, not swallowed: transient errors keep
    /// the child `Running`, but `MAX_POLL_FAILURES` consecutive failures treat
    /// it as dead (see `handle_poll_failure`) instead of leaving a stale
    /// registration + port file behind forever.
    pub fn poll_current_child(&self, workspace_root: &str, generation: u64) -> ChildState {
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let polled = match state.servers.get_mut(workspace_root) {
            Some(m) if m.server.generation == generation => match m.child.as_mut() {
                // Metadata-only registration (tests): nothing to poll.
                None => return ChildState::Running,
                Some(child) => match child.try_wait() {
                    Ok(None) => {
                        m.poll_failures = 0;
                        return ChildState::Running;
                    }
                    Ok(Some(status)) => Ok(status.code()),
                    Err(e) => Err(e.to_string()),
                },
            },
            _ => return ChildState::NotCurrent,
        };
        match polled {
            Ok(code) => {
                if let Some(mut removed) = state.servers.remove(workspace_root) {
                    if let Some(pf) = removed.port_file.take() {
                        let _ = std::fs::remove_file(pf);
                    }
                }
                ChildState::Exited(code)
            }
            Err(detail) => handle_poll_failure(&mut state, workspace_root, &detail),
        }
    }

    /// Remove a workspace's record and return its child + port-file for cleanup.
    pub fn take(&self, workspace_root: &str) -> Option<(Option<Child>, Option<PathBuf>)> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .servers
            .remove(workspace_root)
            .map(|m| (m.child, m.port_file))
    }

    /// Kill every managed child and remove its port-file. Called explicitly on
    /// the quit path: `app.exit` terminates the process via
    /// `std::process::exit`, which never drops Tauri-managed state, so `Drop`
    /// alone would leave orphaned node content servers behind. Draining the
    /// map makes repeat calls no-ops. Recovers from a poisoned lock — a panic
    /// elsewhere must not leave orphaned children behind.
    pub fn shutdown_all(&self) {
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        // Terminal: any registration attempt racing past this point is
        // rejected (see `register_or_existing`), so an in-flight spawn cannot
        // orphan a child at exit.
        state.shutting_down = true;
        for (_root, mut managed) in state.servers.drain() {
            if let Some(mut child) = managed.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            if let Some(pf) = managed.port_file.take() {
                let _ = std::fs::remove_file(pf);
            }
        }
    }
}

/// Shared failure path for a `Child::try_wait` error in `poll_current_child`
/// (also driven directly by tests, which cannot make a real `try_wait` fail):
/// log distinctly, and after `MAX_POLL_FAILURES` consecutive failures treat
/// the child as dead — deregister, best-effort kill + reap, drop the port
/// file — so a stale registration cannot linger forever.
fn handle_poll_failure(state: &mut ManagerState, workspace_root: &str, detail: &str) -> ChildState {
    let Some(m) = state.servers.get_mut(workspace_root) else {
        return ChildState::NotCurrent;
    };
    m.poll_failures += 1;
    log::warn!(
        "[content-server] try_wait failed for '{}' ({}/{}): {}",
        workspace_root,
        m.poll_failures,
        MAX_POLL_FAILURES,
        detail
    );
    if m.poll_failures < MAX_POLL_FAILURES {
        return ChildState::Running;
    }
    log::warn!(
        "[content-server] child for '{}' is un-pollable after {} attempts — treating as dead",
        workspace_root,
        MAX_POLL_FAILURES
    );
    if let Some(mut removed) = state.servers.remove(workspace_root) {
        if let Some(mut child) = removed.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(pf) = removed.port_file.take() {
            let _ = std::fs::remove_file(pf);
        }
    }
    ChildState::Exited(None)
}

impl Drop for ContentServerManager {
    /// Belt-and-braces fallback for the rare paths where the manager value is
    /// actually dropped (tests, a future non-`process::exit` teardown). The
    /// normal quit path never runs this — `app.exit` ends the process without
    /// dropping managed state — so quit-time cleanup is the explicit
    /// `shutdown_all` call in `content_server::cleanup`.
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

// Tests live in a sibling file (test-suffixed, so exempt from the file-size
// gate) but remain a child of this module, so `use super::*` resolves manager
// items; the test-support `impl ContentServerManager` lives there too.
#[cfg(test)]
#[path = "manager.test.rs"]
mod tests;
