//! Tests for the start lifecycle (#279, #316, #318, #323).
//!
//! `start_once` itself needs an `AppHandle` and a real Node runtime, so what
//! is pinned here is the step that decides what a start DOES and had no
//! coverage of its own: the reuse-or-displace decision, which is what hands a
//! caller an existing server. The port-file poll moved to `port_wait.test.rs`
//! with its module; `start_decision` and `server_args` are pinned in
//! `commands.test.rs`, beside the command that loops over attempts.
//! Loaded via `#[path] mod tests;` so `super::*` is the start module.

use super::*;

/// A child that outlives the poll, on either platform (mirrors the helper in
/// `manager.test.rs`).
fn spawn_sleeping() -> Child {
    let mut cmd = if cfg!(windows) {
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

/// A child that is already gone by the time it is polled.
fn spawn_exiting() -> Child {
    let mut child = if cfg!(windows) {
        std::process::Command::new("cmd")
            .args(["/C", "exit"])
            .spawn()
    } else {
        std::process::Command::new("true").spawn()
    }
    .expect("spawn exiting child");
    let _ = child.wait();
    child
}

fn write_record(path: &std::path::Path, token: &str, port: u16) {
    std::fs::write(path, format!("{{\"port\":{port},\"token\":\"{token}\"}}"))
        .expect("write port record");
}

// ── reuse_or_displace ─────────────────────────────────────────────────────

#[test]
fn a_live_same_trust_server_is_reused() {
    let mgr = ContentServerManager::new();
    mgr.register_with_trust("/ws", 4321, "t".into(), Some(spawn_sleeping()), None, true);

    let handle = reuse_or_displace(&mgr, "/ws", true).expect("reused");
    assert_eq!(handle.port, 4321);
    assert_eq!(handle.url, "http://127.0.0.1:4321");
    assert!(handle.trusted);
    assert_eq!(mgr.count(), 1, "reuse leaves the registration alone");
    mgr.shutdown_all();
}

// #318 — a registration is not proof of life. The supervisor polls every two
// seconds, so a child that crashed since its last tick is still on the books;
// returning it handed the caller a `Ready` handle for a port nothing is
// listening on.
#[test]
fn a_crashed_same_trust_server_is_not_reused_and_leaves_the_registry() {
    let mgr = ContentServerManager::new();
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("ws.port.json");
    write_record(&port_file, "t", 4321);
    mgr.register_with_trust(
        "/ws",
        4321,
        "t".into(),
        Some(spawn_exiting()),
        Some(port_file.clone()),
        true,
    );

    assert!(
        reuse_or_displace(&mgr, "/ws", true).is_none(),
        "a dead child is a spawn, not a reuse"
    );
    assert_eq!(mgr.count(), 0, "the poll deregistered the crashed server");
    assert!(!port_file.exists(), "and cleaned up after it");
}

#[test]
fn a_server_with_the_other_trust_is_displaced_rather_than_reused() {
    let mgr = ContentServerManager::new();
    mgr.register_with_trust("/ws", 4321, "t".into(), Some(spawn_sleeping()), None, false);

    assert!(
        reuse_or_displace(&mgr, "/ws", true).is_none(),
        "the CSP is baked in at spawn: the other trust must be restarted"
    );
    assert_eq!(mgr.count(), 0, "the resident was taken for teardown");
}

#[test]
fn nothing_registered_is_a_spawn() {
    let mgr = ContentServerManager::new();
    assert!(reuse_or_displace(&mgr, "/ws", true).is_none());
}
