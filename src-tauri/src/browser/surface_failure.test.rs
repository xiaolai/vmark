//! Audit 20260903 round 3 #31 / round 4 — the classification is an exhaustive
//! match over the typed `NativeSurfaceError`. The per-class code/kind/key/token pins
//! live in `ai_guards.test.rs` (the classifier's public address is
//! `ai_guards::surface_failure`); this file pins what that suite does not: that the
//! typed path and the string seam classify identically, the arm nothing produces
//! any more, and that no two classes collapse onto one `kind`.

use super::*;

fn kind(err: &CommandError) -> String {
    err.detail()
        .and_then(|d| d.get("kind"))
        .and_then(|v| v.as_str())
        .expect("every classified failure names its kind")
        .to_string()
}

/// Every tagged class, built with `detail`.
fn tagged(detail: &str) -> Vec<NativeSurfaceError> {
    NativeSurfaceError::TAGGED
        .iter()
        .map(|make| make(detail.to_string()))
        .collect()
}

#[test]
fn every_class_gets_its_own_kind_and_a_browser_translation_key() {
    let mut kinds: Vec<String> = tagged("x")
        .iter()
        .map(|error| {
            let err = surface_failure(error);
            assert!(
                err.i18n_key()
                    .is_some_and(|key| key.starts_with("errors.browser.")),
                "{error:?} lost its translation key"
            );
            kind(&err)
        })
        .collect();
    kinds.push(kind(&surface_failure(&NativeSurfaceError::Unclassified(
        "nobody classified this".into(),
    ))));
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
fn the_typed_error_and_its_rendering_classify_identically() {
    // Round 4: the surface hands the classifier the enum. The seams that still hold
    // a rendering (`native_failure.rs` names them) must land on the SAME
    // classification, or typing the surface would have changed what a caller sees.
    for error in tagged("some detail") {
        let typed = surface_failure(&error);
        let from_string = surface_failure(&error.to_string());
        let from_str = surface_failure(error.to_string().as_str());
        assert_eq!(typed, from_string, "{error:?}");
        assert_eq!(typed, from_str, "{error:?}");
    }
}

#[test]
fn a_stale_command_class_still_restores_the_typed_conflict() {
    // `eval` no longer flattens a gate refusal to this class (it carries the typed
    // error — eval_outcome.rs), but the class is in the vocabulary and a producer
    // may still raise it; the classifier honours it rather than degrading to
    // `internal`.
    let err = surface_failure(&NativeSurfaceError::StaleCommand("superseded".into()));
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
fn the_full_text_stays_reachable_whatever_the_class() {
    for error in [
        NativeSurfaceError::NoWebview("no webview: tab-9".into()),
        NativeSurfaceError::Unclassified("something nobody classified".into()),
    ] {
        assert_eq!(
            surface_failure(&error)
                .detail()
                .and_then(|d| d.get("detail"))
                .and_then(|v| v.as_str()),
            Some(error.to_string().as_str()),
            "nothing is lost by classifying"
        );
    }
}
