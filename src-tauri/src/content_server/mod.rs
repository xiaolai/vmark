//! Content-server integration (Phase 1).
//!
//! Owns runtime provisioning (`provision`) and the workspace-keyed lifecycle of
//! spawned content-server processes (`ContentServerManager`). The manager keeps
//! one running server per workspace with a generation id so stale shutdowns
//! cannot tear down a newer server for the same workspace (review D2.2,
//! mirroring the MCP bridge generation-counter pattern).
//!
//! The actual process spawn routes through `ai_provider::build_command` +
//! `login_shell_path` (Phase 1 WI-1.2) — not yet wired here; this module
//! currently provides the provisioning state machine + the lifecycle registry,
//! both unit-tested. The spawn + Tauri command surface land alongside the
//! codesigned in-bundle Node runtime (ADR-2, external infra).

// The manager + provisioning logic is the verified Phase 1 core; the Tauri
// command surface and the spawn path that consume it land alongside the
// codesigned in-bundle Node runtime (ADR-2, external infra). Until then these
// items are exercised only by unit tests, so suppress dead-code noise here
// rather than ship a half-wired command.
#![allow(dead_code)]

pub mod commands;
pub mod provision;
pub mod signature;
pub mod slidev;
pub mod slidev_commands;
pub mod swap;

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

    /// Register metadata only (used by unit tests); no child / token.
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
        let mut state = self.inner.lock().expect("content-server manager poisoned");
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

    /// Look up the running server metadata for a workspace.
    pub fn get(&self, workspace_root: &str) -> Option<RunningServer> {
        self.inner
            .lock()
            .expect("content-server manager poisoned")
            .servers
            .get(workspace_root)
            .map(|m| m.server.clone())
    }

    /// The bootstrap token for a workspace's server (for nonce minting).
    pub fn token(&self, workspace_root: &str) -> Option<String> {
        self.inner
            .lock()
            .expect("content-server manager poisoned")
            .servers
            .get(workspace_root)
            .map(|m| m.token.clone())
    }

    /// Deregister a server only if the caller's generation still matches — a
    /// stale shutdown (older generation) is a no-op and returns false.
    pub fn deregister_if_current(&self, workspace_root: &str, generation: u64) -> bool {
        let mut state = self.inner.lock().expect("content-server manager poisoned");
        match state.servers.get(workspace_root) {
            Some(m) if m.server.generation == generation => {
                state.servers.remove(workspace_root);
                true
            }
            _ => false,
        }
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
        let mut state = self.inner.lock().expect("content-server manager poisoned");
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

    /// Remove a workspace's record and return its child + port-file for cleanup.
    pub fn take(&self, workspace_root: &str) -> Option<(Option<Child>, Option<PathBuf>)> {
        self.inner
            .lock()
            .expect("content-server manager poisoned")
            .servers
            .remove(workspace_root)
            .map(|m| (m.child, m.port_file))
    }

    pub fn count(&self) -> usize {
        self.inner
            .lock()
            .expect("content-server manager poisoned")
            .servers
            .len()
    }
}

impl Drop for ContentServerManager {
    /// Best-effort cleanup on app exit (Codex audit): kill any managed child
    /// content servers and remove their port files so nothing is orphaned.
    fn drop(&mut self) {
        if let Ok(mut state) = self.inner.lock() {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_one_server_per_workspace() {
        let mgr = ContentServerManager::new();
        let g1 = mgr.register("/ws/a", 4000);
        let g2 = mgr.register("/ws/b", 4001);
        assert_ne!(g1, g2);
        assert_eq!(mgr.count(), 2);
        assert_eq!(mgr.get("/ws/a").unwrap().port, 4000);
    }

    #[test]
    fn reregister_replaces_and_bumps_generation() {
        let mgr = ContentServerManager::new();
        let g1 = mgr.register("/ws/a", 4000);
        let g2 = mgr.register("/ws/a", 4002);
        assert!(g2 > g1);
        assert_eq!(mgr.count(), 1);
        assert_eq!(mgr.get("/ws/a").unwrap().port, 4002);
    }

    #[test]
    fn stale_shutdown_is_noop() {
        let mgr = ContentServerManager::new();
        let g1 = mgr.register("/ws/a", 4000);
        let g2 = mgr.register("/ws/a", 4002); // newer generation
        // An old shutdown carrying g1 must NOT remove the current (g2) server.
        assert!(!mgr.deregister_if_current("/ws/a", g1));
        assert_eq!(mgr.count(), 1);
        // The current generation can deregister.
        assert!(mgr.deregister_if_current("/ws/a", g2));
        assert_eq!(mgr.count(), 0);
    }
}
