//! Tests for the content-server command surface (see `commands.rs`).
//! Loaded via `#[path] mod tests;` so `super::*` is the commands module —
//! split out to keep `commands.rs` under the 300-line size gate, the same
//! way `manager.test.rs` is.

use super::*;
use crate::command_error::ErrorCode;
use crate::content_server::start::{server_args, start_decision, StartDecision};

#[test]
fn workspace_key_is_stable_and_hex() {
    let k1 = workspace_key("/ws/a");
    let k2 = workspace_key("/ws/a");
    let k3 = workspace_key("/ws/b");
    assert_eq!(k1, k2);
    assert_ne!(k1, k3);
    assert_eq!(k1.len(), 16);
    assert!(k1.chars().all(|c| c.is_ascii_hexdigit()));
}

// WI-FL3.6 — trust is a CSP decision baked into the child at spawn, so a
// running server with the OTHER trust value is restarted, never reused.
fn running(trusted: bool) -> RunningServer {
    RunningServer {
        workspace_root: "/ws".into(),
        port: 7,
        generation: 1,
        trusted,
    }
}

#[test]
fn same_trust_reuses_the_running_server() {
    assert_eq!(start_decision(&running(true), true), StartDecision::Reuse);
    assert_eq!(start_decision(&running(false), false), StartDecision::Reuse);
}

#[test]
fn changed_trust_restarts_the_running_server() {
    assert_eq!(
        start_decision(&running(true), false),
        StartDecision::RestartForTrust
    );
    assert_eq!(
        start_decision(&running(false), true),
        StartDecision::RestartForTrust
    );
}

#[test]
fn spawn_args_carry_trusted_only_for_a_trusted_workspace() {
    let trusted = server_args("/opt/cli.js", "/ws", "tok", "/pf.json", true);
    assert_eq!(
        trusted,
        vec![
            "/opt/cli.js",
            "--root",
            "/ws",
            "--token",
            "tok",
            "--port-file",
            "/pf.json",
            "--trusted"
        ]
    );
    let untrusted = server_args("/opt/cli.js", "/ws", "tok", "/pf.json", false);
    assert!(!untrusted.contains(&"--trusted"));
    assert_eq!(untrusted.len(), 7);
}

// #114 / #123 — a stop that could not finish its teardown is an error, never
// a success: the frontend keeps the server in view and treats a later exit
// as a crash. The record is gone either way, so the second stop is quiet.
#[test]
fn stop_refuses_to_report_success_over_a_port_file_it_could_not_remove() {
    let mgr = ContentServerManager::new();
    assert!(
        stop(&mgr, "/ws").is_ok(),
        "nothing running is the quiet steady state"
    );

    // A directory cannot be removed with `remove_file` on any OS, and the
    // refusal is not `NotFound` — the one error cleanup treats as clean.
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::create_dir(&port_file).expect("dir standing in for the port file");
    mgr.register_running("/ws", 4321, "tok".into(), None, Some(port_file.clone()));

    let err = stop(&mgr, "/ws").expect_err("the port file is still on disk");
    assert_eq!(err.code(), ErrorCode::Io);
    assert!(
        err.message().starts_with(
            "content server for '/ws' was not fully stopped: port file could not be removed: "
        ),
        "{err}"
    );
    let detail = err.detail().expect("detail names each step");
    assert_eq!(detail["child"], serde_json::Value::Null);
    assert!(
        detail["portFile"]
            .as_str()
            .unwrap_or_default()
            .contains("port.json"),
        "{detail}"
    );
    assert!(port_file.exists(), "nothing was removed");
    assert_eq!(mgr.count(), 0, "the record leaves the registry either way");
    assert!(stop(&mgr, "/ws").is_ok(), "a second stop is quiet");
}

#[test]
fn stop_reports_success_only_when_the_teardown_finished() {
    let mgr = ContentServerManager::new();
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::write(&port_file, b"{}").expect("write port file");
    mgr.register_running("/ws", 4321, "tok".into(), None, Some(port_file.clone()));

    assert!(stop(&mgr, "/ws").is_ok());
    assert!(!port_file.exists(), "the port file is gone");
    assert_eq!(mgr.count(), 0);
}

// #280 — zero trust at the IPC edge. An empty root would have the child serve
// its own working directory; a relative one resolves against a process CWD
// the user never chose (in a GUI app, `/`).
#[test]
fn a_start_refuses_a_root_that_is_not_an_absolute_existing_directory() {
    for bad in ["", "relative/ws", "./ws"] {
        let err = check_root(bad).expect_err(bad);
        assert_eq!(err.code(), ErrorCode::InvalidInput, "{bad}");
        assert!(
            err.message()
                .starts_with("workspace root must be an absolute path"),
            "{err}"
        );
    }

    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("gone");
    let err = check_root(missing.to_str().expect("utf-8")).expect_err("missing");
    assert_eq!(err.code(), ErrorCode::NotFound);

    // A FILE at the root path passes an existence check and is still not a
    // workspace.
    let file = dir.path().join("a-file");
    std::fs::write(&file, b"x").expect("write");
    assert_eq!(
        check_root(file.to_str().expect("utf-8"))
            .expect_err("not a directory")
            .code(),
        ErrorCode::NotFound
    );

    check_root(dir.path().to_str().expect("utf-8")).expect("a real directory is fine");
}
