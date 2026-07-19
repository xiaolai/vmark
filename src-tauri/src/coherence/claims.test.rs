// WI-2b.2 — claim lifecycle: stable claim id, supersession chains,
// deterministic current-entry resolution, D4 feed matrix
// (design-2a.md D2/D4; spec §5.4.5 revision 1).

use super::*;
use crate::coherence::types::Envelope;
use uuid::Uuid;

fn entry(body: serde_json::Value) -> Envelope {
    Envelope::new_test("claim", body)
}

fn claim_body(claim: Uuid, statement: &str, maturity: &str) -> serde_json::Value {
    serde_json::json!({
        "claim": claim.to_string(),
        "statement": statement,
        "valid_at": "2026-07-01T00:00:00Z",
        "invalid_at": null,
        "established_by": [],
        "supersedes": null,
        "maturity": maturity,
        "actor": { "type": "human", "id": "tester" }
    })
}

#[test]
fn create_then_promote_keeps_claim_id_and_supersedes_entry() {
    let claim_id = Uuid::now_v7();
    let draft = entry(claim_body(claim_id, "Elena is left-handed", "draft"));
    let mut promoted_body = claim_body(claim_id, "Elena is left-handed", "established");
    promoted_body["supersedes"] = serde_json::json!(draft.id.to_string());
    let promoted = entry(promoted_body);

    let store = ClaimStore::from_entries(&[draft.clone(), promoted.clone()]);
    let current = store.current(claim_id).expect("current entry");
    assert_eq!(current.entry_id, promoted.id);
    assert_eq!(current.maturity, Maturity::Established);
    assert_eq!(store.all_current().len(), 1, "one claim, one current entry");
}

#[test]
fn retirement_by_invalid_at_stays_current_but_unfed() {
    let claim_id = Uuid::now_v7();
    let draft = entry(claim_body(claim_id, "The harbor is open", "draft"));
    let mut est = claim_body(claim_id, "The harbor is open", "established");
    est["supersedes"] = serde_json::json!(draft.id.to_string());
    let established = entry(est);
    let mut retired = claim_body(claim_id, "The harbor is open", "established");
    retired["supersedes"] = serde_json::json!(established.id.to_string());
    retired["invalid_at"] = serde_json::json!("2026-07-10T00:00:00Z");
    let retired = entry(retired);

    let store = ClaimStore::from_entries(&[draft, established, retired.clone()]);
    let current = store.current(claim_id).unwrap();
    assert_eq!(current.entry_id, retired.id);
    // D4.2: invalidated current claims are non-fed.
    assert!(!store.is_fed(claim_id, &[claim_id]));
}

#[test]
fn feed_matrix_requires_established_visible_current_valid() {
    let (a, b, c) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    let draft = entry(claim_body(a, "draft claim", "draft"));
    let established = entry(claim_body(b, "established claim", "established"));
    let invisible = entry(claim_body(c, "not scoped in", "established"));
    let store = ClaimStore::from_entries(&[draft, established, invisible]);

    let visible = vec![a, b]; // c not visible in this context
    assert!(!store.is_fed(a, &visible), "draft is never fed");
    assert!(
        store.is_fed(b, &visible),
        "established + visible + current + valid"
    );
    assert!(!store.is_fed(c, &visible), "not visible in context");
    // Fed set + fingerprint determinism (D5.6).
    let fed = store.fed_claims(&visible);
    assert_eq!(fed.len(), 1);
    let f1 = store.claims_fingerprint(&visible);
    let f2 = store.claims_fingerprint(&visible);
    assert_eq!(f1, f2);
    assert!(f1.starts_with("sha256:"));
}

#[test]
fn empty_feed_fingerprint_is_hash_of_empty_string() {
    let store = ClaimStore::from_entries(&[]);
    // SHA-256 of "" per spec §5.4.4 revision 1.
    assert_eq!(
        store.claims_fingerprint(&[]),
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn concurrent_supersessions_converge_and_surface_conflict() {
    let claim_id = Uuid::now_v7();
    let base = entry(claim_body(claim_id, "v1", "draft"));
    // Two writers supersede the same base entry concurrently.
    let mut ba = claim_body(claim_id, "v2-writer-a", "draft");
    ba["supersedes"] = serde_json::json!(base.id.to_string());
    let mut bb = claim_body(claim_id, "v2-writer-b", "draft");
    bb["supersedes"] = serde_json::json!(base.id.to_string());
    let sup_a = entry(ba);
    let sup_b = entry(bb);

    let store = ClaimStore::from_entries(&[base, sup_a.clone(), sup_b.clone()]);
    // Reader total order decides: latest (time, id) wins — sup_b was
    // minted after sup_a in this test, so it is current.
    let current = store.current(claim_id).unwrap();
    assert_eq!(current.entry_id, sup_b.id);
    // The conflict is surfaced, never hidden (D2.1).
    assert_eq!(store.conflicts().len(), 1);
    assert_eq!(store.conflicts()[0].claim, claim_id);
}

#[test]
fn malformed_claim_entries_are_skipped_not_fatal() {
    let good = entry(claim_body(Uuid::now_v7(), "fine", "draft"));
    let bad = entry(serde_json::json!({ "claim": "not-a-uuid", "statement": 42 }));
    let store = ClaimStore::from_entries(&[bad, good]);
    assert_eq!(store.all_current().len(), 1);
}

#[test]
fn unknown_maturity_is_treated_as_draft_never_fed() {
    let id = Uuid::now_v7();
    let mut body = claim_body(id, "odd maturity", "canonical");
    body["maturity"] = serde_json::json!("canonical");
    let store = ClaimStore::from_entries(&[entry(body)]);
    assert!(
        !store.is_fed(id, &[id]),
        "unknown maturity must not constrain"
    );
}
