//! Unit tests for the CLI install/uninstall module (see `mod.rs`).
//! Split into a sibling file to keep `mod.rs` under the size gate.

use super::*;

#[test]
fn script_content_is_valid_bash() {
    assert!(SCRIPT_CONTENT.starts_with("#!/bin/bash\n"));
    assert!(SCRIPT_CONTENT.ends_with('\n'));
    assert!(SCRIPT_CONTENT.contains("open -b app.vmark"));
}

#[test]
fn cli_parent_dir_derived_from_cli_path() {
    assert_eq!(cli_parent_dir(), "/usr/local/bin");
}

#[test]
fn error_display_cancelled() {
    assert_eq!(
        CliInstallError::Cancelled.to_string(),
        "Operation cancelled."
    );
}

#[test]
fn error_display_foreign() {
    let msg = CliInstallError::ForeignFile.to_string();
    assert!(msg.contains(CLI_PATH));
    assert!(msg.contains("not installed by VMark"));
}

#[test]
fn error_display_failed() {
    let msg = CliInstallError::Failed("boom".to_string()).to_string();
    assert_eq!(msg, "boom");
}

#[test]
fn error_into_string() {
    let s: String = CliInstallError::Cancelled.into();
    assert_eq!(s, "Operation cancelled.");
}

#[test]
fn shell_single_quote_plain_path() {
    assert_eq!(shell_single_quote("/usr/local/bin"), "'/usr/local/bin'");
}

#[test]
fn shell_single_quote_path_with_space() {
    assert_eq!(shell_single_quote("/tmp/with space"), "'/tmp/with space'");
}

#[test]
fn shell_single_quote_disarms_command_injection() {
    // The shape of the attack #921 was filed for: a TMPDIR containing `;`
    // that breaks out of the path argument. After quoting, the `;` and any
    // following command live inside a literal single-quoted string and do
    // nothing.
    let evil = "/tmp/foo;touch /tmp/pwned";
    assert_eq!(shell_single_quote(evil), "'/tmp/foo;touch /tmp/pwned'");
}

#[test]
fn shell_single_quote_handles_dollar_paren_and_backtick() {
    let evil = "/tmp/$(id)/`whoami`";
    assert_eq!(shell_single_quote(evil), "'/tmp/$(id)/`whoami`'");
}

#[test]
fn shell_single_quote_escapes_embedded_single_quote() {
    // POSIX idiom: close, escape, reopen — a single `'` inside the string
    // becomes `'\''` (close-quote, escaped-quote, reopen-quote).
    assert_eq!(shell_single_quote("/a/it's/b"), "'/a/it'\\''s/b'");
}

#[test]
fn shell_single_quote_escapes_multiple_single_quotes() {
    assert_eq!(shell_single_quote("a'b'c"), "'a'\\''b'\\''c'");
}

#[test]
fn shell_single_quote_empty_input() {
    assert_eq!(shell_single_quote(""), "''");
}

#[test]
fn status_not_installed_when_path_missing() {
    // /usr/local/bin/vmark likely doesn't exist in CI/test environments
    // This test is environment-dependent but safe to run
    let status = cli_install_status();
    assert!(status.is_ok());
    // We can't assert installed/foreign since the file may or may not exist
}
