//! Tests for the content-server runtime probe (WI-FL1.1). Loaded via
//! `#[path] mod tests;` from `runtime.rs`.
//!
//! `classify` is pure over the two resolver results, so every state the panel
//! and the startup log line can report is pinned here without a Node binary,
//! an `AppHandle`, or the process environment.

use super::*;
use crate::content_server::spawn::{resolve_cli_from, CliSource};
use serde_json::json;
use std::path::PathBuf;
use tempfile::tempdir;

fn cli(source: CliSource) -> Result<(PathBuf, CliSource), String> {
    Ok((PathBuf::from("/opt/kb/cli.js"), source))
}

/// Test-support only: production reads the two halves separately (the panel
/// decides readiness in `runtimeState.ts`), so this has no caller in the lib.
impl ContentServerRuntime {
    fn is_ready(&self) -> bool {
        self.node == RuntimeState::Ready && self.cli == RuntimeState::Ready
    }
}

#[test]
fn ready_when_node_and_cli_both_resolve() {
    let rt = classify(
        Ok("/usr/local/bin/node".into()),
        cli(CliSource::Provisioned),
    );
    assert_eq!(
        rt,
        ContentServerRuntime {
            node: RuntimeState::Ready,
            node_path: Some("/usr/local/bin/node".into()),
            cli: RuntimeState::Ready,
            cli_source: Some(CliSource::Provisioned),
            detail: None,
        }
    );
    assert!(rt.is_ready());
}

#[test]
fn env_override_reports_cli_ready_from_env() {
    let dir = tempdir().unwrap();
    let cli_path = dir.path().join("cli.js");
    std::fs::write(&cli_path, "// cli").unwrap();
    let env = cli_path.to_string_lossy().to_string();
    let resolved = resolve_cli_from(Some(&env), None, Err("no app data dir".into()));
    let rt = classify(Ok("/usr/bin/node".into()), resolved);
    assert_eq!(rt.cli, RuntimeState::Ready);
    assert_eq!(rt.cli_source, Some(CliSource::Env));
    assert_eq!(rt.detail, None);
}

#[test]
fn nothing_resolves_reports_both_missing_with_every_reason() {
    let dir = tempdir().unwrap();
    let absent = dir.path().join("content-server/base-kb/dist/cli.js");
    let resolved = resolve_cli_from(None, None, Ok(absent));
    let rt = classify(Err("node not found on PATH".into()), resolved);
    assert_eq!(rt.node, RuntimeState::Missing);
    assert_eq!(rt.node_path, None);
    assert_eq!(rt.cli, RuntimeState::Missing);
    assert_eq!(rt.cli_source, None);
    assert_eq!(
        rt.detail.as_deref(),
        Some("node not found on PATH; content-server runtime not provisioned")
    );
    assert!(!rt.is_ready());
}

#[test]
fn node_missing_alone_keeps_the_cli_source() {
    let rt = classify(
        Err("node not found on PATH".into()),
        cli(CliSource::Bundled),
    );
    assert_eq!(rt.node, RuntimeState::Missing);
    assert_eq!(rt.cli, RuntimeState::Ready);
    assert_eq!(rt.cli_source, Some(CliSource::Bundled));
    assert_eq!(rt.detail.as_deref(), Some("node not found on PATH"));
    assert!(!rt.is_ready());
}

#[test]
fn wire_shape_is_camel_case_with_lowercase_enums() {
    let rt = classify(
        Ok("/usr/bin/node".into()),
        Err("content-server runtime not provisioned".into()),
    );
    assert_eq!(
        serde_json::to_value(&rt).unwrap(),
        json!({
            "node": "ready",
            "nodePath": "/usr/bin/node",
            "cli": "missing",
            "cliSource": null,
            "detail": "content-server runtime not provisioned",
        })
    );
}

#[test]
fn log_line_leads_with_node_and_cli_state() {
    let missing = classify(Err("node not found on PATH".into()), Err("nope".into()));
    assert_eq!(
        missing.log_line(),
        "content_server runtime: node=missing cli=missing detail=\"node not found on PATH; nope\""
    );
    let ready = classify(Ok("/usr/bin/node".into()), cli(CliSource::Env));
    assert_eq!(
        ready.log_line(),
        "content_server runtime: node=ready cli=ready node_path=\"/usr/bin/node\" cli_source=env"
    );
}

#[test]
fn log_prefix_is_the_marker_release_smoke_greps_for() {
    // `.github/workflows/release-smoke.yml` polls the packaged app's log for this
    // exact prefix; `scripts/release-smoke-kb-runtime.test.mjs` reads it from
    // this file. Renaming one side without the other breaks the release gate.
    assert_eq!(LOG_PREFIX, "content_server runtime:");
    let rt = classify(Err("x".into()), Err("y".into()));
    assert!(rt.log_line().starts_with(LOG_PREFIX));
}

#[test]
fn a_node_path_with_a_newline_cannot_forge_a_second_log_line() {
    // Unix allows a newline in a path; the line is machine-inspected by
    // release-smoke, so the value is Debug-quoted (#125).
    let rt = classify(Ok("/opt/no de\ncli=ready".into()), Err("nope".into()));
    let line = rt.log_line();
    assert_eq!(line.lines().count(), 1, "one line: {line:?}");
    assert!(
        line.contains("node_path=\"/opt/no de\\ncli=ready\""),
        "{line}"
    );
}

// -- #126: the startup probe is OBSERVED at an orderly quit -------------------
//
// `app.exit` ends the process through `std::process::exit`, so nothing can log
// after it; the one place a missing runtime line can still be explained is
// `content_server::cleanup`, which settles the probe before killing children.
// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature), so every caller is gated the way `fs_scope.test.rs` is.

#[cfg(not(target_os = "windows"))]
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

#[cfg(not(target_os = "windows"))]
#[test]
fn a_probe_still_running_at_shutdown_is_reported_and_the_verdict_is_remembered() {
    let app = mock_app();
    keep_probe(
        app.handle(),
        tauri::async_runtime::spawn(std::future::pending::<()>()),
    );
    assert_eq!(settle_probe(app.handle()), ProbeAtShutdown::StillRunning);
    // Both quit paths run the same cleanup; a second settle repeats the
    // verdict instead of warning twice or claiming the probe never started.
    assert_eq!(settle_probe(app.handle()), ProbeAtShutdown::StillRunning);
}

#[cfg(not(target_os = "windows"))]
#[test]
fn a_finished_probe_needs_no_report() {
    let app = mock_app();
    let handle = tauri::async_runtime::spawn(async {});
    for _ in 0..400 {
        if handle.inner().is_finished() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(
        handle.inner().is_finished(),
        "a ready task must finish within 2s"
    );
    keep_probe(app.handle(), handle);
    assert_eq!(settle_probe(app.handle()), ProbeAtShutdown::Finished);
}

#[cfg(not(target_os = "windows"))]
#[test]
fn a_probe_that_was_never_started_is_reported_at_shutdown() {
    let app = mock_app();
    assert_eq!(settle_probe(app.handle()), ProbeAtShutdown::NeverStarted);
    assert_eq!(settle_probe(app.handle()), ProbeAtShutdown::NeverStarted);
}
