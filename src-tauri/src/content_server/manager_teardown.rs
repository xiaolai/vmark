//! The teardown half of `ContentServerManager`: orphans and shutdown.
//!
//! Split from `manager.rs` at the file-size gate. Same rule as there: the
//! registry lock is held only to decide; every kill + reap runs after it is
//! released (#121).
//!
//! A child a teardown could not stop — or could not reap, short of the OS
//! proving it gone — is NOT forgotten (#122). Its record is gone — the
//! registry must not claim a server it can no longer talk to — but the
//! handle stays here as an orphan, and `shutdown_all` tries it once more at
//! quit, so the log names what outlived the app. A retry cannot succeed
//! where SIGKILL was refused for want of privilege; it can where the refusal
//! was transient, and either way the process is reported, not dropped on
//! the floor. Which failures keep the handle is `ChildFailure::retains_handle`.
//!
//! @coordinates-with manager.rs — the registry these methods drain
//! @coordinates-with cleanup.rs — `CleanupOutcome::take_orphan`
//! @coordinates-with mod.rs — `cleanup(app)` calls `shutdown_all` at quit
//! @module content_server/manager_teardown

use super::ContentServerManager;
use crate::content_server::cleanup::{CleanupOutcome, Detached};

impl ContentServerManager {
    /// Keep ownership of a child a teardown could not stop or reap (#122),
    /// for one more attempt at quit; the report is returned untouched for the
    /// caller to surface. An outcome with no orphan passes straight through.
    ///
    /// The decision is made UNDER the lock that `shutdown_all` drains behind
    /// (#294, #301): a teardown racing application exit used to push its
    /// orphan into a vector quit had already emptied, and nothing ever looked
    /// at that handle again — the process outlived the app, which is the one
    /// outcome this whole path exists to prevent. Once quit has drained, the
    /// retry has to happen HERE, because there is no later.
    pub fn retain_orphan(&self, root: &str, mut outcome: CleanupOutcome) -> CleanupOutcome {
        let Some(child) = outcome.take_orphan() else {
            return outcome;
        };
        let pid = child.id();
        let late = {
            let mut state = self.state();
            if state.shutting_down {
                Some(child)
            } else {
                log::warn!(
                    "[content-server {root}] keeping the handle of pid {pid} for another attempt at quit"
                );
                state.orphans.push((root.to_string(), child));
                None
            }
        };
        if let Some(child) = late {
            log::warn!(
                "[content-server {root}] quit already drained the orphans; last attempt on pid {pid} now"
            );
            // Its own failure is logged by `cleanup`; there is no queue left
            // to hand it to, so the report is the log's last word on it.
            let _ = Detached::child_only(child).cleanup(root);
        }
        outcome
    }

    /// Kill every managed child and remove its port-file, then try once more
    /// on every orphan. Called explicitly on the quit path: `app.exit`
    /// terminates the process via `std::process::exit`, which never drops
    /// Tauri-managed state, so `Drop` alone would leave orphaned node content
    /// servers behind. Draining the map makes repeat calls no-ops. Recovers
    /// from a poisoned lock — a panic elsewhere must not leave orphaned
    /// children behind.
    pub fn shutdown_all(&self) {
        let (drained, orphans) = {
            let mut state = self.state();
            // Terminal: any registration attempt racing past this point is
            // rejected (see `register_or_existing`), so an in-flight spawn
            // cannot orphan a child at exit.
            state.shutting_down = true;
            let drained: Vec<(String, Detached)> = state
                .servers
                .drain()
                .map(|(root, managed)| (root, managed.detach()))
                .collect();
            (drained, std::mem::take(&mut state.orphans))
        };
        // The process is about to exit: each teardown logs its own outcome,
        // and a child still running after this is the log's last word on it.
        for (root, detached) in drained {
            detached.cleanup(&root);
        }
        for (root, child) in orphans {
            Detached::child_only(child).cleanup(&root);
        }
    }
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
