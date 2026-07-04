//! Unit tests for `ContentServerManager` (see `manager.rs`).
//! Loaded via `#[path] mod tests;` so `super::*` is the manager module.

use super::*;
use std::process::Child;

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

fn spawn_exiting() -> Child {
    // `true` exits 0 immediately; portable across macOS/Linux test hosts.
    std::process::Command::new("true")
        .spawn()
        .expect("spawn true")
}

fn spawn_sleeping() -> Child {
    std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .expect("spawn sleep")
}

fn kill_taken(mgr: &ContentServerManager, root: &str) {
    if let Some((Some(mut child), _)) = mgr.take(root) {
        let _ = child.kill();
        let _ = child.wait();
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
    let existing = mgr.register_or_existing(
        "/ws/a",
        4000,
        "tok".into(),
        child,
        std::path::PathBuf::from("/tmp/vmark-test-port-unused"),
    );
    assert!(existing.is_none(), "free root must register, not defer");
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

    let existing = mgr.register_or_existing(
        "/ws/a",
        4001,
        "loser-token".into(),
        loser_child,
        loser_port_file.clone(),
    );

    // The existing (winner) registration is returned and stays current.
    let existing = existing.expect("existing server returned to the loser");
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
