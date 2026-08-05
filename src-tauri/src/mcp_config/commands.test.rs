//! Tests for `commands.rs` (included via `#[path]`).
//!
//! The diagnose command itself reads the real `$HOME`, so what is pinned here
//! is the pure classification step: given what was found at a provider's
//! config path, which `DiagnosticStatus` does the Integrations panel get?
//!
//! The defect these exist for: a config VMark could not parse was classified
//! `NotConfigured`, which the panel renders as "not installed" with an Install
//! button — pointing the user at a path the install code now correctly
//! refuses.

use super::*;
use std::path::Path;

const PROVIDER: ProviderConfig = ProviderConfig {
    name: "Claude Code",
    id: "claude",
    relative_path: ".claude.json",
    legacy: false,
};

const LEGACY_PROVIDER: ProviderConfig = ProviderConfig {
    name: "Gemini CLI",
    id: "gemini",
    relative_path: ".gemini/settings.json",
    legacy: true,
};

/// A binary path that certainly exists on every platform the tests run on.
fn real_binary() -> String {
    std::env::current_exe()
        .expect("the test binary has a path")
        .to_string_lossy()
        .to_string()
}

fn parsed(binary_path: Option<&str>) -> ExistingConfig {
    ExistingConfig::Parsed {
        has_vmark: binary_path.is_some(),
        binary_path: binary_path.map(str::to_string),
    }
}

fn diagnose(existing: ExistingConfig, expected: Option<&str>) -> ProviderDiagnostic {
    build_diagnostic(
        &PROVIDER,
        Path::new("/home/u/.claude.json"),
        existing,
        expected,
    )
}

#[test]
fn an_unparseable_config_is_not_reported_as_not_configured() {
    let d = diagnose(
        ExistingConfig::Unreadable {
            detail: "Invalid JSON: expected value at line 1 column 30".to_string(),
        },
        None,
    );

    assert!(matches!(d.status, DiagnosticStatus::ConfigUnreadable));
    assert!(
        d.config_exists,
        "the file is there — that is the whole difference from NotConfigured"
    );
    assert!(!d.has_vmark, "unknown, and unknown is not yes");
    assert_eq!(d.configured_binary_path, None);
    assert!(!d.binary_exists);
    assert!(
        d.message.contains("Invalid JSON"),
        "the parse detail must survive to the UI: {}",
        d.message
    );
}

#[test]
fn an_absent_config_is_still_not_configured() {
    let d = diagnose(ExistingConfig::Absent, None);
    assert!(matches!(d.status, DiagnosticStatus::NotConfigured));
    assert!(!d.config_exists);
    assert!(d.message.is_empty());
}

#[test]
fn a_parseable_config_without_vmark_is_not_configured() {
    let d = diagnose(parsed(None), None);
    assert!(matches!(d.status, DiagnosticStatus::NotConfigured));
    assert!(
        d.config_exists,
        "the file exists, it just has no vmark entry"
    );
}

#[test]
fn a_vmark_entry_pointing_at_the_expected_binary_is_valid() {
    let bin = real_binary();
    let d = diagnose(parsed(Some(&bin)), Some(&bin));

    assert!(matches!(d.status, DiagnosticStatus::Valid));
    assert_eq!(d.configured_binary_path.as_deref(), Some(bin.as_str()));
    assert!(d.binary_exists);
    assert!(d.message.is_empty());
}

#[test]
fn a_vmark_entry_pointing_at_a_missing_binary_reports_binary_missing() {
    let d = diagnose(parsed(Some("/nowhere/vmark-mcp-server")), None);
    assert!(matches!(d.status, DiagnosticStatus::BinaryMissing));
    assert!(!d.binary_exists);
}

#[test]
fn a_vmark_entry_pointing_elsewhere_reports_a_path_mismatch() {
    // Expected somewhere else entirely — the "moved the app" case.
    let d = diagnose(
        parsed(Some(&real_binary())),
        Some("/Applications/VMark.app/other"),
    );
    assert!(matches!(d.status, DiagnosticStatus::PathMismatch));
}

// -- legacy providers: a row only while there is something to remove --------
//
// Gemini CLI is discontinued. A permanent row would nag every user with an
// Install button for a tool nothing reads; no row at all would strand the
// machines that still carry a vmark entry from an earlier install.

#[test]
fn a_legacy_provider_with_a_vmark_entry_is_listed() {
    assert!(should_list(&LEGACY_PROVIDER, &parsed(Some("/opt/vmark"))));
}

#[test]
fn a_legacy_provider_without_a_vmark_entry_is_not_listed() {
    assert!(!should_list(&LEGACY_PROVIDER, &ExistingConfig::Absent));
    assert!(!should_list(&LEGACY_PROVIDER, &parsed(None)));
    assert!(!should_list(
        &LEGACY_PROVIDER,
        &ExistingConfig::Unreadable {
            detail: "Invalid JSON".to_string()
        }
    ));
}

#[test]
fn an_active_provider_is_always_listed() {
    assert!(should_list(&PROVIDER, &ExistingConfig::Absent));
    assert!(should_list(&PROVIDER, &parsed(None)));
    assert!(should_list(&PROVIDER, &parsed(Some("/opt/vmark"))));
}

#[test]
fn the_diagnostic_carries_the_legacy_flag() {
    let d = build_diagnostic(
        &LEGACY_PROVIDER,
        Path::new("/home/u/.gemini/settings.json"),
        parsed(Some("/opt/vmark")),
        None,
    );
    assert!(d.legacy);
    assert!(!diagnose(parsed(None), None).legacy);
}

#[test]
fn install_and_preview_refuse_a_legacy_provider() {
    let err = require_active(&LEGACY_PROVIDER).expect_err("legacy providers take no new install");
    assert!(err.contains("Gemini CLI"), "unexpected error: {err}");
    require_active(&PROVIDER).expect("active providers install normally");
}
