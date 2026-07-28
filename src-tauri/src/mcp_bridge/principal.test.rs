//! Tests for `principal.rs` — who a bridge connection actually is.
//!
//! The defect these pin (audit 20260728 §2.1): the authorization principal was
//! `identity.name` from the client's own `identify` message. Everything here
//! asserts the replacement property — the principal comes from a credential
//! VMark issued and verified, and from nothing else.

use super::*;

fn tokens() -> Vec<ProviderToken> {
    vec![
        ProviderToken {
            provider: "claude".into(),
            token: "tok-claude".into(),
        },
        ProviderToken {
            provider: "codex".into(),
            token: "tok-codex".into(),
        },
    ]
}

// --- resolution ------------------------------------------------------------

/// The migration state, and the state of every install that predates this
/// mechanism: the sidecar authenticates with the shared port-file token and
/// presents no per-client credential. It is a legitimate client — it just has
/// no name VMark can vouch for.
#[test]
fn no_credential_yields_no_principal() {
    assert_eq!(
        BridgePrincipal::resolve(None, &tokens()),
        BridgePrincipal::Anonymous
    );
}

#[test]
fn a_blank_credential_yields_no_principal() {
    assert_eq!(
        BridgePrincipal::resolve(Some("   "), &tokens()),
        BridgePrincipal::Anonymous
    );
}

/// THE positive case: a provider's own credential names that provider.
#[test]
fn a_providers_credential_yields_that_providers_id() {
    assert_eq!(
        BridgePrincipal::resolve(Some("tok-codex"), &tokens()),
        BridgePrincipal::Provider("codex".into())
    );
    assert_eq!(
        BridgePrincipal::resolve(Some("tok-claude"), &tokens()),
        BridgePrincipal::Provider("claude".into())
    );
}

/// A credential no configured provider holds — rotated away, hand-edited, or
/// belonging to a config VMark could not parse at startup. It names nobody.
/// It does NOT reject the connection: access is the shared bridge token's job,
/// and a broken config must not cost a client every tool it has.
#[test]
fn an_unknown_credential_names_nobody() {
    assert_eq!(
        BridgePrincipal::resolve(Some("tok-nobody"), &tokens()),
        BridgePrincipal::Unrecognized
    );
}

#[test]
fn a_credential_is_matched_whole_not_by_prefix() {
    assert_eq!(
        BridgePrincipal::resolve(Some("tok-code"), &tokens()),
        BridgePrincipal::Unrecognized
    );
    assert_eq!(
        BridgePrincipal::resolve(Some("tok-codexx"), &tokens()),
        BridgePrincipal::Unrecognized
    );
}

/// The copy-paste case: one credential in two providers' configs. First-wins
/// would silently attribute an action to whichever provider the iteration
/// happened to reach first — a forged receipt by accident. Refuse instead.
#[test]
fn a_credential_two_providers_share_names_neither() {
    let shared = vec![
        ProviderToken {
            provider: "claude".into(),
            token: "same".into(),
        },
        ProviderToken {
            provider: "codex".into(),
            token: "same".into(),
        },
    ];
    match BridgePrincipal::resolve(Some("same"), &shared) {
        BridgePrincipal::Ambiguous(providers) => {
            assert_eq!(providers, vec!["claude".to_string(), "codex".to_string()]);
        }
        other => panic!("expected Ambiguous, got {other:?}"),
    }
}

/// Ambiguity is detected by scanning EVERY configured credential, not by
/// stopping at the first match — which is also what keeps the comparison free
/// of a data-dependent early exit.
#[test]
fn resolution_does_not_stop_at_the_first_match() {
    let mut shared = tokens();
    shared.push(ProviderToken {
        provider: "gemini".into(),
        token: "tok-codex".into(),
    });
    match BridgePrincipal::resolve(Some("tok-codex"), &shared) {
        BridgePrincipal::Ambiguous(providers) => {
            assert_eq!(providers, vec!["codex".to_string(), "gemini".to_string()]);
        }
        other => panic!("expected Ambiguous, got {other:?}"),
    }
}

#[test]
fn an_empty_registry_names_nobody() {
    assert_eq!(
        BridgePrincipal::resolve(Some("tok-codex"), &[]),
        BridgePrincipal::Unrecognized
    );
}

// --- authorization ---------------------------------------------------------

#[test]
fn only_a_verified_provider_is_authorized() {
    assert_eq!(
        BridgePrincipal::Provider("codex".into())
            .authorized_id()
            .expect("authorized"),
        "codex"
    );
}

/// Every refusal must tell the user what to do. "no live delegation
/// authorizes …" is what they used to get, and it is unactionable when the
/// real cause is that the client was never identified in the first place.
#[test]
fn every_refusal_names_the_remedy() {
    for principal in [
        BridgePrincipal::Anonymous,
        BridgePrincipal::Unrecognized,
        BridgePrincipal::Ambiguous(vec!["claude".into(), "codex".into()]),
    ] {
        let err = principal
            .authorized_id()
            .expect_err("must not authorize")
            .to_lowercase();
        assert!(err.contains("install"), "{principal:?} -> {err}");
    }
}

#[test]
fn the_ambiguity_refusal_names_the_clients_that_share_the_credential() {
    let err = BridgePrincipal::Ambiguous(vec!["claude".into(), "codex".into()])
        .authorized_id()
        .expect_err("must not authorize");
    assert!(err.contains("claude"), "{err}");
    assert!(err.contains("codex"), "{err}");
}

/// The three refusals must be distinguishable: they have different causes and
/// a support answer that cannot tell them apart is a support answer that
/// guesses.
#[test]
fn the_refusals_are_distinct_messages() {
    let anonymous = BridgePrincipal::Anonymous.authorized_id().unwrap_err();
    let unknown = BridgePrincipal::Unrecognized.authorized_id().unwrap_err();
    let ambiguous = BridgePrincipal::Ambiguous(vec!["claude".into()])
        .authorized_id()
        .unwrap_err();
    assert_ne!(anonymous, unknown);
    assert_ne!(anonymous, ambiguous);
    assert_ne!(unknown, ambiguous);
}

// --- display ---------------------------------------------------------------

#[test]
fn the_log_label_reflects_the_credential_not_a_claim() {
    assert_eq!(BridgePrincipal::Anonymous.label(), "unidentified");
    assert_eq!(
        BridgePrincipal::Unrecognized.label(),
        "unrecognized-credential"
    );
    assert_eq!(BridgePrincipal::Provider("codex".into()).label(), "codex");
    assert_eq!(
        BridgePrincipal::Ambiguous(vec!["a".into(), "b".into()]).label(),
        "ambiguous(a, b)"
    );
}
