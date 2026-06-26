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
    std::process::Command::new("true").spawn().expect("spawn true")
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
    assert_eq!(mgr.poll_current_child("/ws/a", g + 99), ChildState::NotCurrent);
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
