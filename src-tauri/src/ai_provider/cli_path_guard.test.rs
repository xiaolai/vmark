//! WI-0B.2 — tests for the `cli_path` boundary guard.

use super::*;

// ===== Accepts legitimate custom install locations =========================

#[test]
fn accepts_none() {
    assert!(validate_cli_path("claude", None).is_ok());
}

#[test]
fn accepts_matching_basename_in_any_directory() {
    assert!(validate_cli_path("claude", Some("/usr/local/bin/claude")).is_ok());
    assert!(validate_cli_path("claude", Some("/opt/homebrew/bin/claude")).is_ok());
    assert!(validate_cli_path("codex", Some("/Users/me/.local/bin/codex")).is_ok());
    assert!(validate_cli_path("gemini", Some("/nix/store/abc-gemini-1.0/bin/gemini")).is_ok());
}

#[test]
fn accepts_bare_command_name() {
    assert!(validate_cli_path("claude", Some("claude")).is_ok());
}

#[test]
fn windows_shim_extensions_are_windows_only() {
    // Shim suffixes are a Windows concept. On POSIX a `claude.exe` is an
    // unrelated file and must be rejected; on Windows it is the shim.
    let shims = [
        ("claude", r"C:\tools\claude.cmd"),
        ("claude", r"C:\tools\claude.exe"),
        ("codex", r"C:\tools\codex.bat"),
    ];
    for (cmd, path) in shims {
        let result = validate_cli_path(cmd, Some(path));
        if cfg!(windows) {
            assert!(result.is_ok(), "{path} should be accepted on Windows");
        } else {
            assert!(result.is_err(), "{path} must be rejected on POSIX");
        }
    }
}

#[test]
fn ps1_is_never_accepted() {
    // build_command cannot spawn a PowerShell script, so a `.ps1` that passed
    // the guard could never run — reject it on every platform.
    assert!(validate_cli_path("codex", Some(r"C:\tools\codex.ps1")).is_err());
}

#[test]
fn accepts_windows_backslash_paths() {
    let result = validate_cli_path("gemini", Some(r"C:\Program Files\gemini\gemini.exe"));
    if cfg!(windows) {
        assert!(result.is_ok());
    } else {
        assert!(result.is_err());
    }
}

#[test]
fn rejects_parent_directory_traversal() {
    assert!(validate_cli_path("claude", Some("/usr/local/bin/../claude")).is_err());
    assert!(validate_cli_path("claude", Some("../claude")).is_err());
}

// ===== Rejects the RCE shapes =============================================

#[test]
fn rejects_arbitrary_interpreter() {
    // The documented hole: cli_path="/bin/sh" turns an AI request into RCE.
    let err = validate_cli_path("claude", Some("/bin/sh")).unwrap_err();
    assert!(
        err.contains("claude"),
        "error should name the expected binary: {err}"
    );
}

#[test]
fn rejects_other_provider_binary() {
    assert!(validate_cli_path("claude", Some("/usr/local/bin/codex")).is_err());
}

#[test]
fn rejects_name_prefix_and_suffix_tricks() {
    assert!(validate_cli_path("claude", Some("/tmp/claude-evil")).is_err());
    assert!(validate_cli_path("claude", Some("/tmp/evil-claude")).is_err());
    assert!(validate_cli_path("claude", Some("/tmp/claude.sh")).is_err());
    assert!(validate_cli_path("claude", Some("/tmp/notclaude")).is_err());
}

#[test]
fn rejects_empty_and_trailing_separator() {
    assert!(validate_cli_path("claude", Some("")).is_err());
    assert!(validate_cli_path("claude", Some("/usr/local/bin/")).is_err());
}

#[test]
fn rejects_unknown_provider_command() {
    // Defence in depth: only the three known CLI providers may be spawned,
    // even if the basename matches whatever was requested.
    assert!(validate_cli_path("sh", Some("/bin/sh")).is_err());
    assert!(validate_cli_path("bash", Some("/bin/bash")).is_err());
}

#[test]
fn rejects_shell_metacharacters_in_path() {
    assert!(validate_cli_path("claude", Some("/tmp/claude;rm -rf /")).is_err());
    assert!(validate_cli_path("claude", Some("/tmp/$(whoami)/claude")).is_err());
    assert!(validate_cli_path("claude", Some("/tmp/claude\nrm")).is_err());
}

// ===== Edge cases =========================================================

#[test]
fn rejects_null_byte() {
    assert!(validate_cli_path("claude", Some("/usr/bin/claude\0/bin/sh")).is_err());
}

#[test]
fn case_sensitivity_matches_platform_expectations() {
    // Windows shims are case-insensitive; POSIX paths are not.
    let upper = validate_cli_path("claude", Some(r"C:\tools\CLAUDE.EXE"));
    if cfg!(windows) {
        assert!(upper.is_ok());
    } else {
        assert!(upper.is_err());
    }
}
