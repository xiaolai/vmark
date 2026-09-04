//! Audit 20260903 round 3, #31 — the classification is an exhaustive match over
//! `NativeSurfaceError`. The per-class code/kind/key/token pins live in
//! `ai_guards.test.rs` (the classifier's public address is `ai_guards::surface_failure`);
//! this file pins what that suite does not: the arm nothing produces any more, and
//! that no two classes collapse onto one `kind`.

use super::*;
use crate::browser::surface::fail;

fn kind(err: &CommandError) -> String {
    err.detail()
        .and_then(|d| d.get("kind"))
        .and_then(|v| v.as_str())
        .expect("every classified failure names its kind")
        .to_string()
}

#[test]
fn every_class_gets_its_own_kind_and_a_browser_translation_key() {
    let mut kinds: Vec<String> = NativeSurfaceError::TAGGED
        .iter()
        .map(|class| {
            let err = surface_failure(&class.tagged("x"));
            assert!(
                err.i18n_key()
                    .is_some_and(|key| key.starts_with("errors.browser.")),
                "{class:?} lost its translation key"
            );
            kind(&err)
        })
        .collect();
    kinds.push(kind(&surface_failure("nobody tagged this")));
    let total = kinds.len();
    kinds.sort();
    kinds.dedup();
    assert_eq!(
        kinds.len(),
        total,
        "two classes collapsed onto one kind: {kinds:?}"
    );
}

#[test]
fn a_stale_command_tag_still_restores_the_typed_conflict() {
    // `eval` no longer flattens a gate refusal to this tag (it carries the typed
    // error — eval_outcome.rs), but the token is in `mod fail` and a producer may
    // still name it; the classifier honours it rather than degrading to `internal`.
    let err = surface_failure(&format!("{}: superseded", fail::STALE_COMMAND));
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(err.i18n_key(), Some("errors.browser.staleCommand"));
    assert_eq!(kind(&err), "stale-command");
    assert_eq!(
        err.detail()
            .and_then(|d| d.get("mcpCode"))
            .and_then(|v| v.as_str()),
        Some("STALE_COMMAND")
    );
}

#[test]
fn the_original_text_stays_reachable_whatever_the_class() {
    for message in [
        NativeSurfaceError::NoWebview.tagged("no webview: tab-9"),
        "something nobody tagged".to_string(),
    ] {
        assert_eq!(
            surface_failure(&message)
                .detail()
                .and_then(|d| d.get("detail"))
                .and_then(|v| v.as_str()),
            Some(message.as_str()),
            "nothing is lost by classifying"
        );
    }
}
