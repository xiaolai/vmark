//! The supervisor's half of `ContentServerManager`: liveness polling.
//!
//! Split from `manager.rs` at the file-size gate. Same rule as there: the
//! registry lock is held only to decide; a record removed because its child
//! exited, or because it stopped answering `try_wait`, is cleaned up after
//! the lock is released (#121).
//!
//! @coordinates-with manager.rs — the registry these methods read
//! @coordinates-with supervisor.rs — `monitor_child` is the caller
//! @module content_server/manager_poll

use super::{ChildState, ContentServerManager, Managed, ManagerState};
use crate::content_server::cleanup::Detached;

/// Consecutive `Child::try_wait` failures after which the child is treated as
/// dead — a permanently un-pollable child would otherwise leave a stale
/// registration + port file behind forever.
pub(super) const MAX_POLL_FAILURES: u32 = 3;

impl ContentServerManager {
    /// Poll the managed child for a (root, generation) without blocking. On an
    /// unexpected exit the registration is removed and its port-file deleted, so
    /// the supervisor can surface the crash exactly once. A `take()`/stop that
    /// already removed the entry reports `NotCurrent` (no false crash signal).
    /// `try_wait` failures are counted, not swallowed: transient errors keep
    /// the child `Running`, but `MAX_POLL_FAILURES` consecutive failures treat
    /// it as dead (see `handle_poll_failure`) instead of leaving a stale
    /// registration + port file behind forever.
    pub fn poll_current_child(&self, workspace_root: &str, generation: u64) -> ChildState {
        let (state, detached) = {
            let mut state = self.state();
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
                Ok(code) => (
                    ChildState::Exited(code),
                    state.servers.remove(workspace_root).map(Managed::detach),
                ),
                Err(detail) => handle_poll_failure(&mut state, workspace_root, &detail),
            }
        };
        if let Some(d) = detached {
            self.retain_orphan(workspace_root, d.cleanup(workspace_root));
        }
        state
    }
}

/// Shared failure path for a `Child::try_wait` error in `poll_current_child`
/// (also driven directly by tests, which cannot make a real `try_wait` fail):
/// log distinctly, and after `MAX_POLL_FAILURES` consecutive failures treat
/// the child as dead — deregister and hand the record back for a best-effort
/// kill + reap + port-file removal once the lock is gone — so a stale
/// registration cannot linger forever.
pub(super) fn handle_poll_failure(
    state: &mut ManagerState,
    workspace_root: &str,
    detail: &str,
) -> (ChildState, Option<Detached>) {
    let Some(m) = state.servers.get_mut(workspace_root) else {
        return (ChildState::NotCurrent, None);
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
        return (ChildState::Running, None);
    }
    log::warn!(
        "[content-server] child for '{}' is un-pollable after {} attempts — treating as dead",
        workspace_root,
        MAX_POLL_FAILURES
    );
    (
        ChildState::Exited(None),
        state.servers.remove(workspace_root).map(Managed::detach),
    )
}
