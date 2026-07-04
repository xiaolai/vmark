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

/// Internal record: metadata + the spawned child + bootstrap token + port-file.
struct Managed {
    server: RunningServer,
    token: String,
    child: Option<Child>,
    port_file: Option<PathBuf>,
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
    /// for the root (a concurrent-start race winner). Returns `Some(existing)`
    /// without registering when present — the caller must then kill the child
    /// it spawned (Codex audit: prevents orphaning the loser's process).
    pub fn register_or_existing(
        &self,
        workspace_root: &str,
        port: u16,
        token: String,
        mut child: Child,
        port_file: PathBuf,
    ) -> Option<RunningServer> {
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(m) = state.servers.get(workspace_root) {
            // A concurrent start already won — kill the child we were handed so
            // it is not orphaned (std::process::Child does NOT kill on drop).
            let _ = child.kill();
            let _ = child.wait();
            return Some(m.server.clone());
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
            },
        );
        None
    }

    /// Poll the managed child for a (root, generation) without blocking. On an
    /// unexpected exit the registration is removed and its port-file deleted, so
    /// the supervisor can surface the crash exactly once. A `take()`/stop that
    /// already removed the entry reports `NotCurrent` (no false crash signal).
    pub fn poll_current_child(&self, workspace_root: &str, generation: u64) -> ChildState {
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        match state.servers.get_mut(workspace_root) {
            Some(m) if m.server.generation == generation => {
                match m.child.as_mut().map(|c| c.try_wait()) {
                    // try_wait errored — treat as transient, keep watching.
                    Some(Err(_)) | None => ChildState::Running,
                    Some(Ok(None)) => ChildState::Running,
                    Some(Ok(Some(status))) => {
                        let code = status.code();
                        if let Some(mut removed) = state.servers.remove(workspace_root) {
                            if let Some(pf) = removed.port_file.take() {
                                let _ = std::fs::remove_file(pf);
                            }
                        }
                        ChildState::Exited(code)
                    }
                }
            }
            _ => ChildState::NotCurrent,
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
}

/// Test-support API — compiled only for tests so no dead code ships in the
/// production binary. Production registration goes through
/// `register_or_existing`; teardown goes through `take` / `Drop`.
#[cfg(test)]
impl ContentServerManager {
    /// Register metadata only (no child / token).
    pub fn register(&self, workspace_root: &str, port: u16) -> u64 {
        self.register_running(workspace_root, port, String::new(), None, None)
    }

    /// Register a fully-spawned server, returning its generation id. Replaces
    /// any prior registration for the same root.
    pub fn register_running(
        &self,
        workspace_root: &str,
        port: u16,
        token: String,
        child: Option<Child>,
        port_file: Option<PathBuf>,
    ) -> u64 {
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
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
                child,
                port_file,
            },
        );
        generation
    }

    /// Deregister a server only if the caller's generation still matches — a
    /// stale shutdown (older generation) is a no-op and returns false.
    /// Generation-guard API exercised by tests; production `stop()` uses `take`.
    pub fn deregister_if_current(&self, workspace_root: &str, generation: u64) -> bool {
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        match state.servers.get(workspace_root) {
            Some(m) if m.server.generation == generation => {
                state.servers.remove(workspace_root);
                true
            }
            _ => false,
        }
    }

    /// Number of registered servers.
    pub fn count(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .servers
            .len()
    }
}

impl Drop for ContentServerManager {
    /// Best-effort cleanup on app exit (Codex audit): kill any managed child
    /// content servers and remove their port files so nothing is orphaned.
    fn drop(&mut self) {
        // Recover from a poisoned lock too — a panic elsewhere must not leave
        // orphaned child servers behind on exit.
        let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
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

// Tests live in a sibling file (kept under the 300-line file-size gate) but
// remain a child of this module, so `use super::*` resolves manager items.
#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
