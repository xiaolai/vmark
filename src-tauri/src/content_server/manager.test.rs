//! Unit tests for `ContentServerManager` (see `manager.rs`).
//! Loaded via `#[path] mod tests;` so `super::*` is the manager module.
//! Also hosts the test-support `impl ContentServerManager` (moved out of
//! `manager.rs` to keep that file under the 300-line size gate).

use super::*;
use crate::content_server::cleanup::{ChildFailure, CleanupOutcome};
use std::process::Child;

/// Test-support API — compiled only for tests so no dead code ships in the
/// production binary. Production registration goes through
/// `register_or_existing`; teardown goes through `take` / `Drop`.
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
        port_file: Option<std::path::PathBuf>,
    ) -> u64 {
        self.register_with_trust(workspace_root, port, token, child, port_file, false)
    }

    /// `register_running` with an explicit trust value (WI-FL3.6 / #120).
    pub fn register_with_trust(
        &self,
        workspace_root: &str,
        port: u16,
        token: String,
        child: Option<Child>,
        port_file: Option<std::path::PathBuf>,
        trusted: bool,
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
                    trusted,
                },
                token,
                child,
                port_file,
                poll_failures: 0,
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

    /// The bootstrap token alone. Production reads it with the server in one
    /// call (`server_and_token`, #128); tests still assert on it by itself.
    pub fn token(&self, workspace_root: &str) -> Option<String> {
        self.server_and_token(workspace_root)
            .map(|(_, token)| token)
    }

    /// Number of registered servers.
    pub fn count(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .servers
            .len()
    }

    /// Children kept after a teardown confirmed them still running (#122).
    pub fn orphan_count(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .orphans
            .len()
    }

    /// Drive the same failure path a `try_wait` error takes in
    /// `poll_current_child` — tests cannot make a real `Child::try_wait`
    /// fail on demand.
    pub fn force_poll_failure(&self, workspace_root: &str) -> ChildState {
        let (state, detached) = {
            let mut state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            poll::handle_poll_failure(&mut state, workspace_root, "injected test failure")
        };
        if let Some(d) = detached {
            self.retain_orphan(workspace_root, d.cleanup(workspace_root));
        }
        state
    }
}

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

/// A child that exits 0 immediately.
///
/// `true` and `sleep` are Unix binaries. Windows has neither, so nine tests in
/// this module died with `program not found` — on a leg CI's `rust-test`
/// matrix actually runs (`windows-latest`). `pnpm check:all` is frontend-only
/// and `check-cross-target.sh` COMPILES for Windows without running the suite,
/// so nothing local could see it.
fn spawn_exiting() -> Child {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "exit", "0"]);
        c
    } else {
        std::process::Command::new("true")
    };
    cmd.spawn().expect("spawn exiting child")
}

/// A child that stays alive long enough for the test to observe it.
fn spawn_sleeping() -> Child {
    let mut cmd = if cfg!(windows) {
        // PowerShell rather than `timeout`, which needs a console and fails
        // with "input redirection is not supported" when spawned detached.
        let mut c = std::process::Command::new("powershell");
        c.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
        c
    } else {
        let mut c = std::process::Command::new("sleep");
        c.arg("30");
        c
    };
    cmd.spawn().expect("spawn sleeping child")
}

fn kill_taken(mgr: &ContentServerManager, root: &str) {
    if let Some(detached) = mgr.take(root) {
        detached.cleanup(root);
    }
}

#[test]
fn poll_reports_not_current_for_unknown_generation() {
    let mgr = ContentServerManager::new();
    let g = mgr.register_running("/ws/a", 4000, "t".into(), Some(spawn_sleeping()), None);
    assert_eq!(
        mgr.poll_current_child("/ws/a", g + 99),
        ChildState::NotCurrent
    );
    kill_taken(&mgr, "/ws/a");
}

#[test]
fn poll_detects_exit_and_deregisters() {
    let mgr = ContentServerManager::new();
    let mut child = spawn_exiting();
    let _ = child.wait(); // ensure it has exited before we poll
    let g = mgr.register_running("/ws/a", 4000, "t".into(), Some(child), None);
    assert!(matches!(
        mgr.poll_current_child("/ws/a", g),
        ChildState::Exited(_)
    ));
    // The crash detection removed the registration.
    assert_eq!(mgr.count(), 0);
    assert!(mgr.get("/ws/a").is_none());
}

#[test]
fn poll_reports_running_for_live_child() {
    let mgr = ContentServerManager::new();
    let g = mgr.register_running("/ws/a", 4000, "t".into(), Some(spawn_sleeping()), None);
    assert_eq!(mgr.poll_current_child("/ws/a", g), ChildState::Running);
    kill_taken(&mgr, "/ws/a");
}

#[test]
fn poisoned_lock_recovers_instead_of_panicking() {
    use std::sync::Arc;
    let mgr = Arc::new(ContentServerManager::new());
    mgr.register("/ws/a", 4000);
    // Poison the inner mutex by panicking while holding the lock.
    let mgr2 = Arc::clone(&mgr);
    let _ = std::thread::spawn(move || {
        let _guard = mgr2.inner.lock().unwrap();
        panic!("intentional poison");
    })
    .join();
    // Accessors must recover the (consistent) data, not propagate the panic:
    // a poisoned registry would otherwise abort the app in release builds.
    assert_eq!(mgr.count(), 1);
    assert_eq!(mgr.get("/ws/a").unwrap().port, 4000);
    assert_eq!(mgr.token("/ws/a").as_deref(), Some(""));
    assert!(mgr.take("/ws/a").is_some());
    assert_eq!(mgr.count(), 0);
}

/// True while the OS still knows the pid (not yet reaped). `kill(pid, 0)`
/// probes for existence without sending a signal.
#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[test]
fn register_or_existing_wins_when_root_is_free() {
    let mgr = ContentServerManager::new();
    let child = spawn_sleeping();
    let outcome = mgr.register_or_existing(
        "/ws/a",
        4000,
        "tok".into(),
        child,
        std::path::PathBuf::from("/tmp/vmark-test-port-unused"),
        false,
    );
    assert!(
        matches!(outcome, RegisterOutcome::Registered),
        "free root must register, not defer: {outcome:?}"
    );
    let server = mgr.get("/ws/a").expect("registered");
    assert_eq!(server.port, 4000);
    kill_taken(&mgr, "/ws/a");
}

#[test]
fn register_or_existing_loser_keeps_winner_and_kills_loser_child() {
    // Concurrent-start race: a server is already registered for the root when
    // a second spawn finishes. The manager must (1) keep the existing
    // generation current, (2) return the existing server's metadata, and
    // (3) kill + reap the loser's child so it is not orphaned.
    let mgr = ContentServerManager::new();
    let winner_gen = mgr.register_running(
        "/ws/a",
        4000,
        "winner-token".into(),
        Some(spawn_sleeping()),
        None,
    );

    let loser_child = spawn_sleeping();
    #[cfg(unix)]
    let loser_pid = loser_child.id();
    let dir = tempfile::tempdir().expect("tempdir");
    let loser_port_file = dir.path().join("port.json");
    std::fs::write(&loser_port_file, b"{}").expect("write port file");

    let outcome = mgr.register_or_existing(
        "/ws/a",
        4001,
        "loser-token".into(),
        loser_child,
        loser_port_file.clone(),
        false,
    );

    // The existing (winner) registration is returned and stays current.
    let RegisterOutcome::Existing(existing) = outcome else {
        panic!("expected the existing server to be returned to the loser: {outcome:?}");
    };
    assert_eq!(existing.generation, winner_gen);
    assert_eq!(existing.port, 4000);
    assert_eq!(mgr.count(), 1);
    assert_eq!(mgr.get("/ws/a").unwrap().generation, winner_gen);
    assert_eq!(mgr.token("/ws/a").as_deref(), Some("winner-token"));
    // A stale poll carrying a bogus generation still reports NotCurrent.
    assert_eq!(
        mgr.poll_current_child("/ws/a", winner_gen + 99),
        ChildState::NotCurrent
    );

    // The loser's child was killed AND reaped (kill+wait) before returning.
    #[cfg(unix)]
    assert!(
        !pid_alive(loser_pid),
        "loser child {loser_pid} must be terminated, not orphaned"
    );
    // Loser port-file cleanup is the caller's job (commands.rs removes it);
    // the manager must not have deleted a file it doesn't own.
    assert!(loser_port_file.exists());

    kill_taken(&mgr, "/ws/a");
}

#[test]
fn shutdown_all_kills_children_removes_port_files_and_is_idempotent() {
    let mgr = ContentServerManager::new();
    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::write(&port_file, b"{}").expect("write port file");
    mgr.register_running(
        "/ws/a",
        4000,
        "t".into(),
        Some(child),
        Some(port_file.clone()),
    );

    mgr.shutdown_all();

    assert_eq!(mgr.count(), 0, "all registrations must be drained");
    #[cfg(unix)]
    assert!(!pid_alive(pid), "child {pid} must be killed and reaped");
    assert!(!port_file.exists(), "port file must be removed");

    // Repeat call is a no-op on the drained map.
    mgr.shutdown_all();
    assert_eq!(mgr.count(), 0);
}

#[test]
fn register_after_shutdown_rejects_kills_and_reaps() {
    let mgr = ContentServerManager::new();
    mgr.register_running("/ws/a", 4000, "t".into(), Some(spawn_sleeping()), None);
    mgr.shutdown_all();

    // An in-flight spawn finishing right after the drain must NOT slip into
    // the map (nothing would ever kill it again) — reject + kill + reap.
    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::write(&port_file, b"{}").expect("write port file");

    let outcome = mgr.register_or_existing(
        "/ws/a",
        4001,
        "late".into(),
        child,
        port_file.clone(),
        false,
    );

    assert!(
        matches!(outcome, RegisterOutcome::ShuttingDown),
        "post-shutdown registration must be rejected: {outcome:?}"
    );
    assert_eq!(mgr.count(), 0, "shutdown must stay terminal");
    #[cfg(unix)]
    assert!(
        !pid_alive(pid),
        "late child {pid} must be killed and reaped"
    );
    // Port-file cleanup remains the caller's job (the manager never owned it).
    assert!(port_file.exists());
}

#[test]
fn repeated_poll_failures_treat_child_as_dead() {
    let mgr = ContentServerManager::new();
    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::write(&port_file, b"{}").expect("write port file");
    mgr.register_running(
        "/ws/a",
        4000,
        "t".into(),
        Some(child),
        Some(port_file.clone()),
    );

    // Below the threshold, failures are transient: registration is kept.
    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Running);
    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Running);
    assert_eq!(mgr.count(), 1);

    // The Nth consecutive failure gives up: deregister + kill + reap + port file.
    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Exited(None));
    assert_eq!(mgr.count(), 0);
    #[cfg(unix)]
    assert!(!pid_alive(pid), "child {pid} must be killed and reaped");
    assert!(!port_file.exists(), "stale port file must be removed");
}

#[test]
fn successful_poll_resets_failure_count() {
    let mgr = ContentServerManager::new();
    let g = mgr.register_running("/ws/a", 4000, "t".into(), Some(spawn_sleeping()), None);

    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Running);
    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Running);
    // A clean poll (child alive) resets the counter...
    assert_eq!(mgr.poll_current_child("/ws/a", g), ChildState::Running);
    // ...so two more failures are still below the threshold.
    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Running);
    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Running);
    assert_eq!(mgr.count(), 1);
    kill_taken(&mgr, "/ws/a");
}

#[test]
fn poll_failure_on_unknown_root_reports_not_current() {
    let mgr = ContentServerManager::new();
    assert_eq!(mgr.force_poll_failure("/ws/none"), ChildState::NotCurrent);
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

// -- trust-aware registration (#120) and generation-guarded take (#116) ------

#[test]
fn register_or_existing_replaces_a_server_that_enforces_the_other_trust() {
    // Two starts race with OPPOSITE trust values. The first registers; the
    // second must not be handed a server whose CSP is the one it was asked to
    // change — it replaces it, and the displaced child is killed + reaped.
    let mgr = ContentServerManager::new();
    let old_child = spawn_sleeping();
    #[cfg(unix)]
    let old_pid = old_child.id();
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::write(&port_file, b"{}").expect("write port file");
    let old_gen = mgr.register_with_trust(
        "/ws/a",
        4000,
        "old-token".into(),
        Some(old_child),
        Some(port_file.clone()),
        false,
    );

    let new_child = spawn_sleeping();
    let outcome = mgr.register_or_existing(
        "/ws/a",
        4001,
        "new-token".into(),
        new_child,
        port_file.clone(),
        true,
    );

    assert!(
        matches!(outcome, RegisterOutcome::Registered),
        "a trust mismatch is a replacement, not a reuse: {outcome:?}"
    );
    let current = mgr.get("/ws/a").expect("registered");
    assert!(current.trusted, "the newcomer's trust is what runs");
    assert_eq!(current.port, 4001);
    assert!(
        current.generation > old_gen,
        "a replacement is a new generation"
    );
    assert_eq!(mgr.token("/ws/a").as_deref(), Some("new-token"));
    assert_eq!(mgr.count(), 1);
    #[cfg(unix)]
    assert!(
        !pid_alive(old_pid),
        "displaced child {old_pid} must be killed and reaped"
    );
    // The two records named the SAME port-file path; it now belongs to the
    // newcomer and must not have been removed under it.
    assert!(port_file.exists());
    // The displaced generation's supervisor sees NotCurrent and ends quietly.
    assert_eq!(
        mgr.poll_current_child("/ws/a", old_gen),
        ChildState::NotCurrent
    );

    kill_taken(&mgr, "/ws/a");
}

#[test]
fn take_if_generation_only_removes_the_generation_the_caller_observed() {
    // `get` then `take` let another start replace the server in between, and
    // the stop then killed the NEWER one. The guarded take refuses.
    let mgr = ContentServerManager::new();
    let g1 = mgr.register_running("/ws/a", 4000, "t1".into(), Some(spawn_sleeping()), None);
    let g2 = mgr.register_running("/ws/a", 4002, "t2".into(), Some(spawn_sleeping()), None);
    assert!(g2 > g1);

    assert!(
        mgr.take_if_generation("/ws/a", g1).is_none(),
        "a stale generation must not take the current server"
    );
    assert_eq!(mgr.get("/ws/a").expect("still registered").generation, g2);

    let detached = mgr
        .take_if_generation("/ws/a", g2)
        .expect("the current generation can be taken");
    detached.cleanup("/ws/a");
    assert_eq!(mgr.count(), 0);
}

#[test]
fn server_and_token_come_from_one_record() {
    // The two-call form (`get`, then `token`) could pair one generation's port
    // with the next generation's token across a restart (#128).
    let mgr = ContentServerManager::new();
    assert!(mgr.server_and_token("/ws/a").is_none());
    mgr.register_running("/ws/a", 4000, "tok".into(), None, None);
    let (server, token) = mgr.server_and_token("/ws/a").expect("registered");
    assert_eq!(server.port, 4000);
    assert_eq!(token, "tok");
}

#[test]
fn poll_failure_cleanup_happens_after_the_lock_is_released() {
    // The registry lock must not be held across kill + reap: a poll that gave
    // up on a child has to leave the manager usable from another thread while
    // the reap is in flight. The observable half is that the record is gone
    // and the child reaped — and that nothing deadlocks on the way.
    use std::sync::Arc;
    let mgr = Arc::new(ContentServerManager::new());
    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    mgr.register_running("/ws/a", 4000, "t".into(), Some(child), None);
    for _ in 0..(poll::MAX_POLL_FAILURES - 1) {
        assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Running);
    }
    assert_eq!(mgr.force_poll_failure("/ws/a"), ChildState::Exited(None));
    #[cfg(unix)]
    assert!(!pid_alive(pid), "child {pid} must be killed and reaped");
    assert!(mgr.get("/ws/a").is_none());
}

// -- #122: a child a teardown could not stop stays OWNED, and quit retries ----

#[test]
fn a_child_confirmed_still_running_is_kept_and_killed_once_more_at_shutdown() {
    let mgr = ContentServerManager::new();
    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    // A real same-uid child never refuses SIGKILL, so the outcome a refusing
    // one would produce is built by hand around a live process.
    let outcome = CleanupOutcome {
        child: Some(ChildFailure::StillRunning {
            pid: child.id(),
            reason: "refused".into(),
        }),
        port_file: None,
        orphan: Some(child),
    };

    let report = mgr.retain_orphan("/ws/a", outcome);
    assert!(
        report.orphan.is_none(),
        "the handle belongs to the manager now"
    );
    assert!(!report.is_clean(), "the report is what the caller surfaces");
    assert_eq!(mgr.orphan_count(), 1);
    assert_eq!(mgr.count(), 0, "an orphan is not a registered server");
    #[cfg(unix)]
    assert!(pid_alive(pid), "nothing has been killed yet");

    mgr.shutdown_all();
    assert_eq!(mgr.orphan_count(), 0, "quit tried it once more");
    #[cfg(unix)]
    assert!(!pid_alive(pid), "the retry killed and reaped it");
}

// #294 / #301 — a teardown racing application exit used to push its orphan
// into a vector `shutdown_all` had already drained: nothing looked at that
// handle again, and the node server outlived the app. Once quit has drained,
// the last attempt happens inside `retain_orphan` itself.
#[test]
fn an_orphan_handed_over_after_shutdown_is_killed_now_rather_than_queued() {
    let mgr = ContentServerManager::new();
    mgr.shutdown_all();

    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    let outcome = CleanupOutcome {
        child: Some(ChildFailure::StillRunning {
            pid: child.id(),
            reason: "refused".into(),
        }),
        port_file: None,
        orphan: Some(child),
    };

    let report = mgr.retain_orphan("/ws/a", outcome);
    assert!(report.orphan.is_none(), "the handle was taken either way");
    assert!(!report.is_clean(), "the report still says what happened");
    assert_eq!(
        mgr.orphan_count(),
        0,
        "queueing it would hand it to a drain that has already run"
    );
    #[cfg(unix)]
    assert!(!pid_alive(pid), "child {pid} was killed here instead");
}

#[test]
fn a_clean_outcome_leaves_no_orphan_behind() {
    let mgr = ContentServerManager::new();
    let report = mgr.retain_orphan("/ws/a", CleanupOutcome::default());
    assert!(report.is_clean());
    assert_eq!(mgr.orphan_count(), 0);
}
