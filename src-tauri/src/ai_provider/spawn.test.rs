//! Tests for `spawn.rs` — process-spawn platform utilities.

use super::*;

/// `build_command` output must stay spawnable after the Windows
/// `CREATE_NO_WINDOW` flag is applied (issue #1091 regression guard).
/// Uses the platform's trivial echo so this holds on every CI OS.
#[test]
fn build_command_spawns_after_hide_console_window() {
    #[cfg(target_os = "windows")]
    let output = build_command("cmd.exe", &["/c", "echo vmark"]).output();
    #[cfg(not(target_os = "windows"))]
    let output = build_command("echo", &["vmark"]).output();

    let output = output.expect("build_command must produce a spawnable command");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("vmark"));
}

/// `which_command` must stay spawnable after the hidden-console flag is
/// applied on Windows (issue #1091 regression guard). Only asserts the
/// spawn itself — whether the lookup finds a hit depends on the env.
#[test]
fn which_command_spawns_after_hide_console_window() {
    let output = which_command().arg("cargo").output();
    assert!(output.is_ok(), "which/where must spawn: {:?}", output.err());
}

/// On macOS/Linux the lookup binary itself must resolve from the trusted
/// absolute path when it exists, so a hijacked parent PATH can't swap it.
#[cfg(unix)]
#[test]
fn which_command_prefers_absolute_path() {
    if std::path::Path::new("/usr/bin/which").exists() {
        assert_eq!(
            which_command().get_program().to_str(),
            Some("/usr/bin/which")
        );
    }
}

// ---------------------------------------------------------------------------
// capture_stdout_with_timeout
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn sh(script: &str) -> Command {
    let mut c = Command::new("/bin/sh");
    c.args(["-c", script]);
    c
}

#[cfg(unix)]
#[test]
fn capture_returns_stdout_on_success() {
    let out = capture_stdout_with_timeout(
        sh("printf hello-capture"),
        std::time::Duration::from_secs(5),
        "test",
    );
    assert_eq!(out.as_deref(), Some("hello-capture"));
}

#[cfg(unix)]
#[test]
fn capture_none_on_nonzero_exit() {
    let out = capture_stdout_with_timeout(
        sh("printf partial; exit 3"),
        std::time::Duration::from_secs(5),
        "test",
    );
    assert_eq!(out, None);
}

#[test]
fn capture_none_on_spawn_failure() {
    let out = capture_stdout_with_timeout(
        Command::new("/no/such/binary/vmark-xyz"),
        std::time::Duration::from_secs(1),
        "test",
    );
    assert_eq!(out, None);
}

#[cfg(unix)]
#[test]
fn capture_timeout_kills_long_running_child() {
    let started = std::time::Instant::now();
    let out = capture_stdout_with_timeout(
        sh("sleep 10"),
        std::time::Duration::from_millis(200),
        "test",
    );
    assert_eq!(out, None);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(3),
        "timeout must kill the child promptly, took {:?}",
        started.elapsed()
    );
}

// ---------------------------------------------------------------------------
// parse_sentinel
// ---------------------------------------------------------------------------

#[test]
fn parse_sentinel_extracts_trimmed_value() {
    assert_eq!(
        parse_sentinel("noise<S>  /home/x/.zsh  <E>tail", "<S>", "<E>"),
        Some("/home/x/.zsh".to_string())
    );
}

#[test]
fn parse_sentinel_none_when_markers_missing() {
    assert_eq!(parse_sentinel("<S>only start, no end", "<S>", "<E>"), None);
    assert_eq!(parse_sentinel("no markers at all", "<S>", "<E>"), None);
}

#[test]
fn parse_sentinel_empty_between_markers() {
    // Unset value prints START immediately followed by END → empty value.
    assert_eq!(parse_sentinel("<S><E>", "<S>", "<E>"), Some(String::new()));
}

/// An END marker in startup noise BEFORE the START marker must not confuse
/// the parse (the old inline Windows logic sliced `raw[s..e]` with `e < s`,
/// which panics).
#[test]
fn parse_sentinel_ignores_end_marker_before_start() {
    assert_eq!(
        parse_sentinel("<E>noise<S>value<E>", "<S>", "<E>"),
        Some("value".to_string())
    );
}
