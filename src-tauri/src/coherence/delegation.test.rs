// WI-3.3 — delegation lifecycle: required-expiry grants bound to the
// authenticated bridge principal, supersession revocation, and the full
// authorization matrix (design-3.md D2; spec §5.4.7 revision 2).

use super::*;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Envelope, WriterId};
use uuid::Uuid;

const NOW: &str = "2026-07-19T12:00:00Z";
const FUTURE: &str = "2026-07-26T00:00:00Z";
const PAST: &str = "2026-07-01T00:00:00Z";

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let td = tempfile::tempdir().expect("tempdir");
    let kernel = WorkspaceKernel::open(td.path(), WriterId(Uuid::now_v7())).expect("kernel");
    (td, kernel)
}

fn grant_entry(
    grant: Uuid,
    principal: &str,
    scope: &[&str],
    expires: &str,
    supersedes: Option<Uuid>,
) -> Envelope {
    Envelope::new_test(
        "delegation",
        serde_json::json!({
            "delegation": grant.to_string(),
            "actor": { "type": "human", "id": "xiaolai" },
            "delegate": { "type": "external", "id": principal },
            "scope": scope,
            "expires": expires,
            "supersedes": supersedes.map(|s| s.to_string()),
        }),
    )
}

#[test]
fn live_grant_authorizes_matching_principal_and_scope() {
    let grant = Uuid::now_v7();
    let store = DelegationStore::from_entries(&[grant_entry(
        grant,
        "codex-cli",
        &["resolve.accept-newer"],
        FUTURE,
        None,
    )]);
    assert!(store
        .live_delegation_for("codex-cli", "resolve.accept-newer", NOW)
        .is_some());
    // The full rejection matrix:
    assert!(
        store
            .live_delegation_for("claude-code", "resolve.accept-newer", NOW)
            .is_none(),
        "principal mismatch"
    );
    assert!(
        store
            .live_delegation_for("codex-cli", "resolve.waive", NOW)
            .is_none(),
        "scope mismatch"
    );
}

#[test]
fn expired_grants_never_authorize() {
    let store = DelegationStore::from_entries(&[grant_entry(
        Uuid::now_v7(),
        "codex-cli",
        &["resolve.waive"],
        PAST,
        None,
    )]);
    assert!(store
        .live_delegation_for("codex-cli", "resolve.waive", NOW)
        .is_none());
}

#[test]
fn empty_scope_supersession_revokes() {
    let grant = Uuid::now_v7();
    let e1 = grant_entry(grant, "codex-cli", &["resolve.accept-newer"], FUTURE, None);
    let e2 = grant_entry(grant, "codex-cli", &[], FUTURE, Some(e1.id));
    let store = DelegationStore::from_entries(&[e1, e2]);
    assert!(store
        .live_delegation_for("codex-cli", "resolve.accept-newer", NOW)
        .is_none());
}

#[test]
fn concurrent_supersession_resolves_deterministically() {
    let grant = Uuid::now_v7();
    let base = grant_entry(grant, "codex-cli", &["resolve.accept-newer"], FUTURE, None);
    let rival_a = grant_entry(grant, "codex-cli", &[], FUTURE, Some(base.id));
    let rival_b = grant_entry(
        grant,
        "codex-cli",
        &["resolve.accept-newer", "resolve.waive"],
        FUTURE,
        Some(base.id),
    );
    let store = DelegationStore::from_entries(&[base, rival_a, rival_b.clone()]);
    // Latest in reader order (rival_b) is current; the conflict surfaces.
    assert!(store
        .live_delegation_for("codex-cli", "resolve.waive", NOW)
        .is_some());
    assert_eq!(store.conflicts().len(), 1);
}

#[test]
fn perform_grant_requires_future_expiry_and_known_scope() {
    let (_td, mut kernel) = workspace();
    let err = perform_delegate(
        &mut kernel,
        &DelegateRequest {
            delegate: "codex-cli".into(),
            scope: vec!["resolve.accept-newer".into()],
            expires: PAST.into(),
            revoke: None,
        },
        "xiaolai",
        NOW,
    )
    .unwrap_err();
    assert!(err.contains("future"), "{err}");
    let err2 = perform_delegate(
        &mut kernel,
        &DelegateRequest {
            delegate: "codex-cli".into(),
            scope: vec!["claims.promote".into()],
            expires: FUTURE.into(),
            revoke: None,
        },
        "xiaolai",
        NOW,
    )
    .unwrap_err();
    assert!(err2.contains("scope"), "{err2}");
}

#[test]
fn grant_then_revoke_roundtrip_through_the_kernel() {
    let (_td, mut kernel) = workspace();
    let receipt = perform_delegate(
        &mut kernel,
        &DelegateRequest {
            delegate: "codex-cli".into(),
            scope: vec!["resolve.accept-newer".into(), "resolve.waive".into()],
            expires: FUTURE.into(),
            revoke: None,
        },
        "xiaolai",
        NOW,
    )
    .unwrap();
    let entries = kernel.ledger().read_all().unwrap().entries;
    let store = DelegationStore::from_entries(&entries);
    assert!(store
        .live_delegation_for("codex-cli", "resolve.waive", NOW)
        .is_some());

    perform_delegate(
        &mut kernel,
        &DelegateRequest {
            delegate: "codex-cli".into(),
            scope: vec![],
            expires: FUTURE.into(),
            revoke: Some(receipt.grant),
        },
        "xiaolai",
        NOW,
    )
    .unwrap();
    let entries = kernel.ledger().read_all().unwrap().entries;
    let store = DelegationStore::from_entries(&entries);
    assert!(store
        .live_delegation_for("codex-cli", "resolve.waive", NOW)
        .is_none());
}

#[test]
fn malformed_delegation_entries_quarantine_at_typed_validation() {
    // Known kind now (spec rev 2): missing expires is malformed.
    let bad = Envelope::new_test(
        "delegation",
        serde_json::json!({
            "delegation": Uuid::now_v7().to_string(),
            "actor": { "type": "human", "id": "x" },
            "delegate": { "type": "external", "id": "codex-cli" },
            "scope": ["resolve.waive"],
        }),
    );
    assert!(bad.typed().is_err(), "missing expires must be malformed");
}

#[test]
fn nonhuman_resolution_without_delegation_ref_is_malformed() {
    let bad = Envelope::new_test(
        "waiver",
        serde_json::json!({
            "edge": { "txf": Uuid::now_v7().to_string(), "input": 0 },
            "upstream_object": Uuid::now_v7().to_string(),
            "pinned": format!("rev1:{}", "a".repeat(64)),
            "resolved_against": format!("rev1:{}", "b".repeat(64)),
            "actor": { "type": "agent", "id": "codex-cli" },
            "reason": "delegated waive",
        }),
    );
    assert!(
        bad.typed().is_err(),
        "agent resolution needs a delegation ref"
    );
    let good = Envelope::new_test(
        "waiver",
        serde_json::json!({
            "edge": { "txf": Uuid::now_v7().to_string(), "input": 0 },
            "upstream_object": Uuid::now_v7().to_string(),
            "pinned": format!("rev1:{}", "a".repeat(64)),
            "resolved_against": format!("rev1:{}", "b".repeat(64)),
            "actor": { "type": "agent", "id": "codex-cli" },
            "reason": "delegated waive",
            "delegation": Uuid::now_v7().to_string(),
        }),
    );
    assert!(good.typed().is_ok(), "{:?}", good.typed().err());
}
