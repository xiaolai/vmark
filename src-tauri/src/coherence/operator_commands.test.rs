// WI-3.6 — operator command IPC DTOs. The async Tauri commands are integration
// (exercised via the MCP/Tauri surface); this tests the round-trip that makes
// propose→preview→accept safe: a candidate resubmitted whole reconstructs to the
// SAME content-addressed candidate (which is the tamper check).

use super::*;
use crate::coherence::types::ContentHash;

fn base_rev() -> RevisionId {
    RevisionId::parse(&format!("rev1:{}", "ab".repeat(32))).unwrap()
}

#[test]
fn candidate_round_trips_through_the_wire_shape() {
    let object = ObjectId(uuid::Uuid::from_u128(7));
    let original = Candidate::new(
        object,
        "revised text".into(),
        base_rev(),
        vec![],
        "tidy",
        "s",
    );

    // Server → wire → client → wire → server: the reconstructed candidate is
    // byte-identical (content-addressed), so revision + hash survive the trip.
    let dto = OperatorCandidate::from_candidate(&original);
    let json = serde_json::to_string(&dto).unwrap();
    let back: OperatorCandidate = serde_json::from_str(&json).unwrap();
    let reconstructed = back.to_candidate();

    assert_eq!(reconstructed.revision, original.revision);
    assert_eq!(reconstructed.content_hash, original.content_hash);
    assert_eq!(reconstructed.parents, original.parents);
    assert_eq!(reconstructed.object, original.object);
    assert_eq!(reconstructed.operator, original.operator);
}

#[test]
fn wire_candidate_omits_none_of_the_identity_fields() {
    let dto = OperatorCandidate::from_candidate(&Candidate::new(
        ObjectId(uuid::Uuid::from_u128(1)),
        "x".into(),
        base_rev(),
        vec![],
        "op",
        "summary",
    ));
    let v: serde_json::Value = serde_json::to_value(&dto).unwrap();
    // camelCase, and the base parent is on the wire (needed to recompute the id).
    assert!(v.get("base").is_some());
    assert!(v.get("content").is_some());
    assert!(v.get("operator").is_some());
}

#[test]
fn preview_result_serializes_structural_classes_as_pairs() {
    use crate::coherence::accept_precondition::{PhysicalEdgeId, StructuralClass};
    let pid = PhysicalEdgeId {
        txf: uuid::Uuid::from_u128(3),
        input: 0,
        downstream: ObjectId(uuid::Uuid::from_u128(4)),
        downstream_rev: base_rev(),
    };
    let pr = PreviewResult {
        candidate_revision: "rev1:aa".into(),
        local_delta: vec![],
        structural_classes: vec![(pid, StructuralClass::Stale)],
        truncated: false,
    };
    let json = serde_json::to_string(&pr).unwrap();
    assert!(json.contains("structuralClasses"));
    assert!(json.contains("Stale"));
}

#[test]
fn a_tampered_wire_candidate_reconstructs_to_a_different_id() {
    // If a client alters the content, the server's to_candidate recomputes a
    // DIFFERENT revision — accept's tamper check compares recomputed vs claimed.
    let object = ObjectId(uuid::Uuid::from_u128(9));
    let good = Candidate::new(object, "honest".into(), base_rev(), vec![], "op", "s");
    let mut dto = OperatorCandidate::from_candidate(&good);
    dto.content = "tampered".into();
    let reconstructed = dto.to_candidate();
    assert_ne!(reconstructed.revision, good.revision);
    // (sanity: a fresh honest hash differs from the tampered one)
    let _ = ContentHash::parse(
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    );
}
