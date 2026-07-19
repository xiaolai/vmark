// WI-3.1 — dry-run candidate projection. A candidate that advances an upstream
// restales the incident edge (Fresh -> Stale) in the preview delta, and mints
// nothing. Composes edges_incident_to + project_edge + structural_class.

use super::*;
use crate::coherence::operator::Candidate;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, InputRole, Intent, ObjectId,
    OutputRef, RevisionId, Transformation, WriterId,
};

const NOW: &str = "2026-07-20T00:00:00Z";

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

fn txf(writer: WriterId, object: ObjectId, n: u8, inputs: Vec<(ObjectId, RevisionId)>) -> Envelope {
    let revision = RevisionId::compute(&hash(n), &[]);
    let body = serde_json::to_value(Transformation {
        inputs: inputs
            .into_iter()
            .map(|(object, revision)| InputRef {
                object,
                revision,
                role: InputRole::Direct,
                kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
            })
            .collect(),
        outputs: vec![OutputRef {
            object,
            revision,
            content_hash: hash(n),
            parents: vec![],
        }],
        agent: Agent {
            kind: AgentType::Human,
            id: None,
        },
        intent: Intent {
            kind: "test".into(),
            summary: "preview".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
    })
    .unwrap();
    Envelope::create("transformation", writer, body)
}

/// Index: U@u1 -> D@d1 (D derived from U@u1). Returns (index, U, D, u1).
fn indexed() -> (CoherenceIndex, ObjectId, ObjectId, RevisionId) {
    let (mut index, _) = CoherenceIndex::open_in_memory().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let u1 = RevisionId::compute(&hash(1), &[]);
    index
        .rebuild_from(&[
            txf(writer, u, 1, vec![]),
            txf(writer, d, 2, vec![(u, u1.clone())]),
        ])
        .unwrap();
    (index, u, d, u1)
}

#[test]
fn candidate_advancing_upstream_restales_the_incident_edge() {
    let (index, u, _d, u1) = indexed();
    // A candidate new revision of U over the base u1.
    let candidate = Candidate::new(u, "U revised".into(), u1, vec![], "tidy", "s");

    let preview = index.project_candidates(&candidate, NOW).unwrap();

    assert!(!preview.truncated);
    assert_eq!(preview.candidate_revision, candidate.revision);
    assert_eq!(preview.local_delta.len(), 1, "one incident edge restales");
    let d0 = &preview.local_delta[0];
    assert_eq!(
        d0.before,
        StructuralClass::Fresh {
            ratified: false,
            ahead: false
        }
    );
    assert_eq!(d0.after, StructuralClass::Stale);
    // The structural-class map (for the accept precondition) records it as Stale.
    assert_eq!(
        preview.structural_classes.get(&d0.edge),
        Some(&StructuralClass::Stale)
    );
}

#[test]
fn preview_mints_nothing() {
    let (index, u, _d, u1) = indexed();
    let before = index.breakdown(NOW).unwrap();
    let candidate = Candidate::new(u, "U revised".into(), u1, vec![], "tidy", "s");
    let _ = index.project_candidates(&candidate, NOW).unwrap();
    let after = index.breakdown(NOW).unwrap();
    assert_eq!(
        before, after,
        "the preview must not mutate the committed index"
    );
}

#[test]
fn group_preview_surfaces_new_conformance_edges() {
    // #5 (design-accept-consistency): an Extract-Canon-style group (a carrier +
    // a conformer that declares a conformance input to the carrier) must surface
    // the NEW conformance edge in the preview delta — not just persisted edges.
    let (mut index, _u, _d, _u1) = indexed();
    let writer = WriterId(uuid::Uuid::now_v7());
    let conf = ObjectId(uuid::Uuid::now_v7());
    let conf1 = RevisionId::compute(&hash(7), &[]);
    index.apply_entry(&txf(writer, conf, 7, vec![])).unwrap();

    let carrier_obj = ObjectId(uuid::Uuid::now_v7());
    let carrier = Candidate::new_root(
        carrier_obj,
        "canon".into(),
        vec![],
        "extract-canon",
        "canon",
    );
    let conformance = InputRef {
        object: carrier_obj,
        revision: carrier.revision.clone(),
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Conformance,
    };
    let conformer = Candidate::new(
        conf,
        "conform".into(),
        conf1,
        vec![conformance],
        "extract-canon",
        "conform",
    );
    let group = vec![carrier, conformer];

    let preview = index.project_group(&group, NOW).unwrap();

    // The new conformance edge appears: synthetic nil txf, downstream = conformer.
    let d = preview
        .local_delta
        .iter()
        .find(|d| d.edge.downstream == conf)
        .expect("the new conformance edge must be in the preview delta");
    assert_eq!(d.edge.txf, uuid::Uuid::nil(), "synthetic display txf");
    assert_eq!(
        d.before,
        StructuralClass::Retired,
        "a brand-new edge did not exist before"
    );
    assert_eq!(
        d.after,
        StructuralClass::Fresh {
            ratified: false,
            ahead: false
        }
    );
    // Display-only: synthetic edges must NOT gate the accept precondition.
    assert!(
        !preview
            .base_classes
            .keys()
            .any(|k| k.txf == uuid::Uuid::nil()),
        "synthetic edges must stay out of base_classes"
    );
}

#[test]
fn candidate_on_an_object_with_no_edges_has_an_empty_delta() {
    let (index, _u, _d, _u1) = indexed();
    let lonely = ObjectId(uuid::Uuid::now_v7());
    let base = RevisionId::compute(&hash(9), &[]);
    let candidate = Candidate::new(lonely, "x".into(), base, vec![], "tidy", "s");
    let preview = index.project_candidates(&candidate, NOW).unwrap();
    assert!(preview.local_delta.is_empty());
    assert!(preview.structural_classes.is_empty());
}
