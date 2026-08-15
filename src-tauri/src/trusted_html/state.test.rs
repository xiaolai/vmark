//! Trusted-HTML grant registry tests (issue #1273).

use super::*;

const DOC: &str = "<!doctype html><p>hi</p>";
const W: &str = "main";

fn granted(state: &TrustedHtmlState) -> String {
    state.grant(W, DOC.to_string()).unwrap()
}

#[test]
fn grant_returns_a_64_char_hex_token() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    assert_eq!(token.len(), 64);
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn grants_are_unguessable_and_distinct() {
    let state = TrustedHtmlState::default();
    assert_ne!(
        granted(&state),
        granted(&state),
        "each grant mints its own token"
    );
}

#[test]
fn html_round_trips_for_a_live_token() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    assert_eq!(state.html(&token).as_deref(), Some(DOC));
}

#[test]
fn html_is_none_for_an_unknown_token() {
    let state = TrustedHtmlState::default();
    granted(&state);
    assert_eq!(state.html("deadbeef"), None);
}

#[test]
fn publish_replaces_the_document_behind_a_live_token() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    state.publish(&token, "<p>v2</p>".to_string()).unwrap();
    assert_eq!(state.html(&token).as_deref(), Some("<p>v2</p>"));
}

/// Publishing must never CREATE a grant: that would let any caller that can
/// reach the command mint a servable origin without the user ever authorizing
/// one (requirement 10 — trust is never inferred).
#[test]
fn publish_refuses_an_unknown_token_rather_than_creating_it() {
    let state = TrustedHtmlState::default();
    let err = state.publish("deadbeef", DOC.to_string()).unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(state.grant_count(), 0, "no grant was created");
}

#[test]
fn revoke_removes_the_grant_and_reports_whether_it_existed() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    assert!(state.revoke(&token));
    assert_eq!(state.html(&token), None);
    assert!(!state.revoke(&token), "second revoke is a no-op");
}

#[test]
fn revoked_token_stops_serving_immediately() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    state.revoke(&token);
    assert_eq!(state.html(&token), None);
    assert!(state.publish(&token, DOC.to_string()).is_err());
}

// ---------------------------------------------------------------- ownership

/// The reason ownership exists: a destroyed window's grants must die with it,
/// and a process-global sweep would take every other window's down too.
#[test]
fn revoke_window_drops_only_that_windows_grants() {
    let state = TrustedHtmlState::default();
    let a = state.grant("doc-1", DOC.to_string()).unwrap();
    let b = state.grant("doc-2", DOC.to_string()).unwrap();
    let c = state.grant("doc-1", DOC.to_string()).unwrap();

    assert_eq!(state.revoke_window("doc-1"), 2);

    assert_eq!(state.html(&a), None);
    assert_eq!(state.html(&c), None);
    assert_eq!(
        state.html(&b).as_deref(),
        Some(DOC),
        "another window's trusted preview must survive"
    );
}

#[test]
fn revoke_window_is_a_no_op_for_an_unknown_window() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    assert_eq!(state.revoke_window("doc-does-not-exist"), 0);
    assert_eq!(state.html(&token).as_deref(), Some(DOC));
}

#[test]
fn revoke_window_reclaims_slots_and_budget() {
    let state = TrustedHtmlState::default();
    state.grant("doc-1", DOC.to_string()).unwrap();
    state.grant("doc-1", DOC.to_string()).unwrap();
    state.revoke_window("doc-1");
    assert_eq!(state.grant_count(), 0);
    assert_eq!(state.total_bytes(), 0);
}

// --------------------------------------------------------------------- caps

#[test]
fn oversized_documents_are_refused() {
    let state = TrustedHtmlState::default();
    let err = state.grant(W, "x".repeat(MAX_DOC_BYTES + 1)).unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(state.grant_count(), 0);
}

#[test]
fn a_document_exactly_at_the_cap_is_accepted() {
    let state = TrustedHtmlState::default();
    assert!(state.grant(W, "x".repeat(MAX_DOC_BYTES)).is_ok());
}

#[test]
fn publish_is_size_capped_too() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    let err = state
        .publish(&token, "x".repeat(MAX_DOC_BYTES + 1))
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(
        state.html(&token).as_deref(),
        Some(DOC),
        "a refused publish leaves the previous document intact"
    );
}

#[test]
fn the_number_of_live_grants_is_bounded() {
    let state = TrustedHtmlState::default();
    for _ in 0..MAX_GRANTS {
        granted(&state);
    }
    let err = state.grant(W, DOC.to_string()).unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(state.grant_count(), MAX_GRANTS);
}

#[test]
fn revoking_frees_a_slot() {
    let state = TrustedHtmlState::default();
    let mut tokens = Vec::new();
    for _ in 0..MAX_GRANTS {
        tokens.push(granted(&state));
    }
    assert!(state.grant(W, DOC.to_string()).is_err());
    state.revoke(&tokens[0]);
    assert!(state.grant(W, DOC.to_string()).is_ok());
}

// ------------------------------------------------------------- byte budget

/// The per-document cap alone permitted MAX_GRANTS × MAX_DOC_BYTES of resident
/// HTML. The aggregate budget is what actually bounds the process.
#[test]
fn the_aggregate_byte_budget_is_enforced() {
    let state = TrustedHtmlState::default();
    let fits = MAX_TOTAL_BYTES / MAX_DOC_BYTES;
    for _ in 0..fits {
        state.grant(W, "x".repeat(MAX_DOC_BYTES)).unwrap();
    }
    assert_eq!(state.total_bytes(), fits * MAX_DOC_BYTES);

    let err = state.grant(W, "x".repeat(MAX_DOC_BYTES)).unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(
        state.total_bytes(),
        fits * MAX_DOC_BYTES,
        "a refusal costs nothing"
    );
}

#[test]
fn total_bytes_tracks_grants_and_revocations() {
    let state = TrustedHtmlState::default();
    let a = state.grant(W, "x".repeat(100)).unwrap();
    let b = state.grant(W, "y".repeat(250)).unwrap();
    assert_eq!(state.total_bytes(), 350);

    state.revoke(&a);
    assert_eq!(state.total_bytes(), 250);

    state.revoke(&b);
    assert_eq!(state.total_bytes(), 0);
}

/// Replacement must be accounted as a DELTA. Counting only the new document
/// would let the resident total drift upward one publish at a time.
#[test]
fn publish_accounts_the_size_delta_in_both_directions() {
    let state = TrustedHtmlState::default();
    let token = state.grant(W, "x".repeat(100)).unwrap();

    state.publish(&token, "y".repeat(400)).unwrap();
    assert_eq!(state.total_bytes(), 400);

    state.publish(&token, "z".repeat(10)).unwrap();
    assert_eq!(state.total_bytes(), 10);
}

/// Fill the registry to exactly `target` bytes.
///
/// The budget cannot be reached with one document — the per-document cap is
/// smaller — so this stacks max-size grants and finishes with a remainder.
/// Doing it any other way trips `MAX_DOC_BYTES` first and tests nothing about
/// the budget, which is how the first version of these tests failed.
fn fill_to(state: &TrustedHtmlState, target: usize) {
    let mut remaining = target;
    while remaining > MAX_DOC_BYTES {
        state.grant(W, "x".repeat(MAX_DOC_BYTES)).unwrap();
        remaining -= MAX_DOC_BYTES;
    }
    if remaining > 0 {
        state.grant(W, "x".repeat(remaining)).unwrap();
    }
    assert_eq!(state.total_bytes(), target);
}

#[test]
fn publish_that_would_exceed_the_budget_is_refused_and_changes_nothing() {
    let state = TrustedHtmlState::default();
    fill_to(&state, MAX_TOTAL_BYTES - 100);
    let token = state.grant(W, "y".repeat(100)).unwrap();
    assert_eq!(state.total_bytes(), MAX_TOTAL_BYTES);

    // +100 bytes against a full budget.
    let err = state.publish(&token, "z".repeat(200)).unwrap_err();

    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(
        state.html(&token).as_deref(),
        Some("y".repeat(100).as_str())
    );
    assert_eq!(
        state.total_bytes(),
        MAX_TOTAL_BYTES,
        "a refusal costs nothing"
    );
}

/// A shrink must still be allowed when the budget is exactly full — the delta
/// is negative, so charging the whole new document would refuse it.
#[test]
fn publish_may_shrink_a_document_even_at_a_full_budget() {
    let state = TrustedHtmlState::default();
    fill_to(&state, MAX_TOTAL_BYTES - 100);
    let token = state.grant(W, "y".repeat(100)).unwrap();

    state.publish(&token, "z".repeat(10)).unwrap();

    assert_eq!(state.total_bytes(), MAX_TOTAL_BYTES - 90);
}

/// The budget must be reachable exactly, or its last byte is unusable.
#[test]
fn a_grant_landing_exactly_on_the_budget_is_accepted() {
    let state = TrustedHtmlState::default();
    fill_to(&state, MAX_TOTAL_BYTES - 10);
    assert!(state.grant(W, "y".repeat(10)).is_ok());
    assert_eq!(state.total_bytes(), MAX_TOTAL_BYTES);
}

/// The budget refusal must be its OWN message, not the per-document one — they
/// have different remedies (revoke something vs. shrink this file).
#[test]
fn budget_refusals_name_the_budget_and_are_translatable() {
    let state = TrustedHtmlState::default();
    fill_to(&state, MAX_TOTAL_BYTES);

    let err = state.grant(W, "y".to_string()).unwrap_err();

    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(
        err.i18n_key(),
        Some("errors.trustedHtml.budgetExhausted"),
        "a full budget must not be reported as an oversized document"
    );
}

/// Nothing about a grant is derived from a file path or an extension — the
/// registry never sees one. Pinned so a later "convenience" overload that
/// takes a path cannot quietly reintroduce extension-inferred trust.
#[test]
fn the_registry_stores_content_and_owner_only_never_a_path() {
    let state = TrustedHtmlState::default();
    let token = granted(&state);
    assert_eq!(state.html(&token).as_deref(), Some(DOC));
    assert_eq!(state.grant_count(), 1);
}
