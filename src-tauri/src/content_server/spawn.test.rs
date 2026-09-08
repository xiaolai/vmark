//! Tests for `resolve_cli_from` — the pure resolution order behind
//! `resolve_cli` (WI-FL0.8). Loaded via `#[path] mod tests;` from `spawn.rs`.
//!
//! The order is env override → bundled resource → provisioned app-data bundle.
//! Each candidate is passed in explicitly so the order can be pinned without an
//! `AppHandle` and without mutating the process environment (which would race
//! every other test in the binary).

use super::*;
use std::path::Path;
use tempfile::tempdir;

fn touch(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, "// cli").expect("write fixture");
    p
}

const NOT_PROVISIONED: &str = "content-server runtime not provisioned";

#[test]
fn env_override_wins_when_it_points_at_a_file() {
    let dir = tempdir().unwrap();
    let env_cli = touch(dir.path(), "env-cli.js");
    let bundled = touch(dir.path(), "bundled-cli.js");
    let provisioned = touch(dir.path(), "provisioned-cli.js");
    let env = env_cli.to_string_lossy().to_string();
    let got = resolve_cli_from(Some(&env), Some(Ok(bundled)), Ok(provisioned)).unwrap();
    assert_eq!(got, (env_cli, CliSource::Env));
}

#[test]
fn env_override_pointing_at_a_missing_file_is_an_error_not_a_fallthrough() {
    let dir = tempdir().unwrap();
    let bundled = touch(dir.path(), "bundled-cli.js");
    let missing = dir.path().join("nowhere/cli.js");
    let env = missing.to_string_lossy().to_string();
    let err = resolve_cli_from(Some(&env), Some(Ok(bundled)), Err("unused".into())).unwrap_err();
    assert!(
        err.contains("VMARK_CONTENT_SERVER_CLI"),
        "names the variable: {err}"
    );
    assert!(err.contains("nowhere/cli.js"), "names the path: {err}");
}

#[test]
fn empty_or_blank_env_override_is_treated_as_unset() {
    let dir = tempdir().unwrap();
    let bundled = touch(dir.path(), "bundled-cli.js");
    for blank in ["", "   "] {
        let got =
            resolve_cli_from(Some(blank), Some(Ok(bundled.clone())), Err("unused".into())).unwrap();
        assert_eq!(got, (bundled.clone(), CliSource::Bundled));
    }
}

#[test]
fn bundled_resource_is_used_when_no_override_and_it_exists() {
    let dir = tempdir().unwrap();
    let bundled = touch(dir.path(), "bundled-cli.js");
    let provisioned = touch(dir.path(), "provisioned-cli.js");
    let got = resolve_cli_from(None, Some(Ok(bundled.clone())), Ok(provisioned)).unwrap();
    assert_eq!(got, (bundled, CliSource::Bundled));
}

#[test]
fn missing_bundled_resource_falls_through_to_provisioned() {
    let dir = tempdir().unwrap();
    let provisioned = touch(dir.path(), "provisioned-cli.js");
    let ghost = dir.path().join("resources/content-server-dist/cli.js");
    let got = resolve_cli_from(None, Some(Ok(ghost)), Ok(provisioned.clone())).unwrap();
    assert_eq!(got, (provisioned, CliSource::Provisioned));
}

#[test]
fn no_bundled_resource_configured_falls_through_to_provisioned() {
    let dir = tempdir().unwrap();
    let provisioned = touch(dir.path(), "provisioned-cli.js");
    let got = resolve_cli_from(None, None, Ok(provisioned.clone())).unwrap();
    assert_eq!(got, (provisioned, CliSource::Provisioned));
}

#[test]
fn nothing_available_reports_not_provisioned() {
    let dir = tempdir().unwrap();
    let absent = dir.path().join("content-server/base-kb/dist/cli.js");
    let err = resolve_cli_from(None, None, Ok(absent)).unwrap_err();
    assert_eq!(err, NOT_PROVISIONED);
}

#[test]
fn unresolvable_app_data_dir_only_matters_once_the_provisioned_candidate_is_reached() {
    let dir = tempdir().unwrap();
    let env_cli = touch(dir.path(), "env-cli.js");
    let env = env_cli.to_string_lossy().to_string();
    // Earlier candidates short-circuit, exactly as before the refactor.
    assert!(resolve_cli_from(Some(&env), None, Err("no app data dir".into())).is_ok());
    // Reached, the reason is surfaced verbatim rather than masked as "not provisioned".
    let err = resolve_cli_from(None, None, Err("no app data dir".into())).unwrap_err();
    assert_eq!(err, "no app data dir");
}

#[test]
fn cli_source_serializes_lowercase_on_the_wire() {
    let wire = |s: CliSource| serde_json::to_string(&s).unwrap();
    assert_eq!(wire(CliSource::Env), "\"env\"");
    assert_eq!(wire(CliSource::Bundled), "\"bundled\"");
    assert_eq!(wire(CliSource::Provisioned), "\"provisioned\"");
}

#[test]
fn a_configured_bundled_resource_that_cannot_be_resolved_is_an_error_not_a_fallthrough() {
    // `BUNDLED_CLI_RESOURCE` names a resource the path resolver cannot place:
    // a packaging fault. Masking it as "not provisioned" would send the user
    // to install a runtime that is supposed to ship in the bundle (#133).
    let dir = tempdir().unwrap();
    let provisioned = touch(dir.path(), "provisioned-cli.js");
    let err = resolve_cli_from(
        None,
        Some(Err(
            "bundled resource could not be resolved: no resource dir".into(),
        )),
        Ok(provisioned),
    )
    .unwrap_err();
    assert!(err.contains("could not be resolved"), "got: {err}");
    // The env override still wins before the bundled candidate is consulted.
    let env_cli = touch(dir.path(), "env-cli.js");
    let env = env_cli.to_string_lossy().to_string();
    assert!(resolve_cli_from(Some(&env), Some(Err("unused".into())), Err("unused".into())).is_ok());
}

// ── the node lookup, folded (#311) ────────────────────────────────────────
//
// `resolve_node` shells out to `which`; what it DOES with the answer is
// `node_from_lookup`, which is pure — so every branch is pinned here rather
// than depending on whether the machine running the suite happens to have
// node, or not have it.

#[test]
fn a_successful_lookup_yields_the_first_candidate_trimmed() {
    assert_eq!(
        node_from_lookup(true, b"/usr/local/bin/node\n").expect("found"),
        "/usr/local/bin/node"
    );
    // `which -a`-style output, and a CRLF line ending: the first line is what
    // a shell would run.
    assert_eq!(
        node_from_lookup(true, b"/opt/node\r\n/usr/bin/node\n").expect("found"),
        "/opt/node"
    );
    assert_eq!(
        node_from_lookup(true, b"  /usr/bin/node  ").expect("found"),
        "/usr/bin/node"
    );
}

#[test]
fn a_non_zero_status_is_not_on_path_whatever_it_printed() {
    let err = node_from_lookup(false, b"/usr/bin/node\n").expect_err("status wins");
    assert_eq!(err, "node not found on PATH");
}

// A zero exit with nothing usable on stdout is the shape that used to slip
// through as an EMPTY command path and fail later as "exited before
// reporting a port", naming neither cause.
#[test]
fn a_successful_lookup_that_printed_nothing_usable_is_not_on_path() {
    for out in [&b""[..], b"\n", b"   \n \n", b"\r\n"] {
        assert_eq!(
            node_from_lookup(true, out).expect_err("nothing usable"),
            "node not found on PATH"
        );
    }
}

// `which` writes bytes, not `String`: a path that is not UTF-8 must not
// panic — it is replaced and reported, and the spawn then fails by name.
#[test]
fn output_that_is_not_utf8_is_replaced_rather_than_panicking() {
    let path = node_from_lookup(true, b"/usr/bin/n\xffode\n").expect("still a path");
    assert!(path.contains('\u{FFFD}'), "{path}");
}

// -- spawn_supervised: the process is spawned with both pipes taken and each
// drained on its own thread until the child exits (#134). A shell stands in
// for Node: the wiring does not care what the program is.

use crate::content_server::cleanup::Detached;
use std::io;
use std::process::Command;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

/// A program that prints one line on each stream and exits 0.
fn one_line_on_each_stream() -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", "echo out-line& echo err-line 1>&2"]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", "echo out-line; echo err-line 1>&2"]);
        c
    }
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[test]
fn spawn_supervised_takes_both_pipes_and_delivers_each_line_tagged_with_its_stream() {
    let (tx, rx) = mpsc::channel::<(Stream, String)>();
    let mut child = spawn_supervised(one_line_on_each_stream(), move |stream, line| {
        let _ = tx.send((stream, line.to_string()));
    })
    .expect("spawn");
    assert!(
        child.stdout.is_none() && child.stderr.is_none(),
        "both pipes are owned by the drain threads"
    );
    assert!(child.wait().expect("wait").success());

    // The sink is dropped when BOTH drain threads end — which they do at EOF,
    // i.e. once the child has exited. A hang here is a drain that never ends.
    let mut lines = Vec::new();
    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(line) => lines.push(line),
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                panic!("drain threads still running 5s after the child exited: {lines:?}")
            }
        }
    }
    assert!(
        lines
            .iter()
            .any(|(s, l)| *s == Stream::Stdout && l.trim() == "out-line"),
        "{lines:?}"
    );
    assert!(
        lines
            .iter()
            .any(|(s, l)| *s == Stream::Stderr && l.trim() == "err-line"),
        "{lines:?}"
    );
}

#[test]
fn spawn_supervised_reports_a_missing_executable_and_spawns_nothing() {
    let dir = tempdir().unwrap();
    let err = spawn_supervised(Command::new(dir.path().join("no-such-node")), |_, _| {})
        .expect_err("nothing to run");
    assert_eq!(err.kind(), io::ErrorKind::NotFound);
}

#[test]
fn spawn_server_runs_the_program_through_build_command_and_its_child_can_be_cleaned_up() {
    // The real entry point: `build_command` + the login-shell PATH + the
    // pipes. The child stays alive so the cleanup has something to kill.
    let (program, args): (&str, Vec<&str>) = if cfg!(windows) {
        (
            "powershell",
            vec![
                "-NoProfile",
                "-Command",
                "Write-Output hi; Start-Sleep -Seconds 30",
            ],
        )
    } else {
        ("sh", vec!["-c", "echo hi; exec sleep 30"])
    };
    let child = spawn_server(program, &args, "/ws").expect("spawn through build_command");
    #[cfg(unix)]
    let pid = child.id();
    assert!(child.stdout.is_none() && child.stderr.is_none());
    let outcome = Detached::child_only(child).cleanup("/ws");
    assert!(outcome.is_clean(), "{outcome}");
    #[cfg(unix)]
    assert!(!pid_alive(pid), "child {pid} must be killed and reaped");
}

/// #312 — the node lookup must stay bounded.
///
/// `which` stats every entry on PATH, and one entry on a hung network mount
/// blocks that stat for as long as the mount takes to give up. `resolve_node`
/// is awaited by `content_server_start`, so a bare `Command::output()` here
/// parks a tokio worker indefinitely. The hang cannot be reproduced in a unit
/// test without a filesystem that stalls on demand, so the property is asserted
/// against the source: the call must go through the crate's kill-and-reap
/// capture, never through `.output()`.
#[test]
fn resolve_node_captures_with_a_timeout_rather_than_waiting_forever() {
    // CRLF-normalised, and BOUNDED with `split_once` — the same class as
    // `mcp_bridge/token_file.test.rs`. `include_str!` keeps the file's bytes,
    // so on a Windows checkout `"\n}\n"` never matches and `split(..).next()`
    // silently returned the whole rest of the file as the "body". This test
    // stayed GREEN that way only because nothing below `resolve_node` happens
    // to call `.output()`; the sibling case failed loudly, this one did not,
    // and a widened body is the same defect either way.
    let source = include_str!("spawn.rs").replace("\r\n", "\n");
    let after = source
        .split_once("pub fn resolve_node()")
        .expect("resolve_node is defined in this module")
        .1;
    let body = after
        .split_once("\n}\n")
        .expect("the function body ends at a closing brace in column zero")
        .0;
    // Comments explain the removed `.output()` call; strip them before
    // matching, or the explanation reads as the defect.
    let code: String = body
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        code.contains("capture_stdout_with_timeout"),
        "resolve_node must bound the lookup:\n{code}"
    );
    assert!(
        !code.contains(".output()"),
        "`Command::output()` waits without a bound — that is audit 20260907 \
         #312 returning:\n{code}"
    );
}
