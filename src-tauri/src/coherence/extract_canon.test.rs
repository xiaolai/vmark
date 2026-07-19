// WI-4.3 — Extract-Canon: the changeset shape + a full commit through the
// group-commit, asserting the conformance edges land with the right kind.

use super::*;
use crate::coherence::accept_group::accept_group;
use crate::coherence::dag::Resolved;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, Intent, OutputRef,
    Transformation, WriterId,
};

const NOW: &str = "2026-07-20T00:00:00Z";

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

fn seed(writer: WriterId, object: ObjectId, n: u8) -> Envelope {
    Envelope::create(
        "transformation",
        writer,
        serde_json::to_value(Transformation {
            inputs: Vec::<InputRef>::new(),
            outputs: vec![OutputRef {
                object,
                revision: RevisionId::compute(&hash(n), &[]),
                content_hash: hash(n),
                parents: vec![],
            }],
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "test".into(),
                summary: "seed".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .unwrap(),
    )
}

#[test]
fn changeset_is_a_carrier_plus_one_conformance_candidate_each() {
    let carrier_obj = ObjectId(uuid::Uuid::from_u128(100));
    let c1 = Conformer {
        object: ObjectId(uuid::Uuid::from_u128(1)),
        content: "scene one".into(),
        base: RevisionId::compute(&hash(1), &[]),
    };
    let c2 = Conformer {
        object: ObjectId(uuid::Uuid::from_u128(2)),
        content: "scene two".into(),
        base: RevisionId::compute(&hash(2), &[]),
    };
    let cs = extract_canon(carrier_obj, "MAGIC canon".into(), "magic", &[c1, c2]);
    assert_eq!(cs.len(), 3, "carrier + 2 conformers");

    // The carrier is a brand-new root object.
    assert_eq!(cs[0].object, carrier_obj);
    assert!(cs[0].parents.is_empty(), "carrier is a root revision");
    assert_eq!(cs[0].operator, "extract-canon");

    // Each conformer declares ONE conformance input to the carrier.
    for conf in &cs[1..] {
        assert_eq!(conf.inputs.len(), 1);
        assert_eq!(conf.inputs[0].object, carrier_obj);
        assert_eq!(
            conf.inputs[0].kind,
            crate::coherence::edge_kind::OriginEdgeKind::Conformance
        );
        assert_eq!(conf.inputs[0].revision, cs[0].revision);
    }
}

#[test]
fn extract_canon_commits_carrier_and_conformance_edges() {
    let dir = tempfile::tempdir().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let mut kernel = WorkspaceKernel::open(dir.path(), writer).unwrap();

    // Two existing conformer objects.
    let s1 = ObjectId(uuid::Uuid::now_v7());
    let s2 = ObjectId(uuid::Uuid::now_v7());
    kernel.append_and_apply(&seed(writer, s1, 1)).unwrap();
    kernel.append_and_apply(&seed(writer, s2, 2)).unwrap();
    let s1_rev = RevisionId::compute(&hash(1), &[]);
    let s2_rev = RevisionId::compute(&hash(2), &[]);

    let carrier_obj = ObjectId(uuid::Uuid::now_v7());
    let changeset = extract_canon(
        carrier_obj,
        "the magic system canon".into(),
        "magic",
        &[
            Conformer {
                object: s1,
                content: "scene one".into(),
                base: s1_rev,
            },
            Conformer {
                object: s2,
                content: "scene two".into(),
                base: s2_rev,
            },
        ],
    );

    let preview = kernel.index().project_group(&changeset, NOW).unwrap();
    let receipts = accept_group(&mut kernel, &changeset, &preview, NOW).unwrap();
    assert_eq!(receipts.len(), 3);
    assert!(receipts.iter().all(|r| r.committed));

    // The carrier now exists as a live object.
    assert_eq!(
        kernel.index().resolve_live(&carrier_obj).unwrap(),
        Resolved::Single(changeset[0].revision.clone())
    );

    // The carrier is the upstream of two CONFORMANCE edges (one per conformer).
    let incident = kernel.index().edges_incident_to(&carrier_obj).unwrap();
    let conformance: Vec<_> = incident
        .edges
        .iter()
        .filter(|e| {
            e.upstream == carrier_obj
                && e.kind == crate::coherence::edge_kind::OriginEdgeKind::Conformance
        })
        .collect();
    assert_eq!(conformance.len(), 2, "two conformance edges recorded");
    let downstreams: std::collections::HashSet<_> =
        conformance.iter().map(|e| e.downstream).collect();
    assert!(downstreams.contains(&s1) && downstreams.contains(&s2));
}
