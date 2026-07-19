// WI-3.0a — bounded incident-edge query (design v4.4). Correctness of the
// upstream ∪ downstream union that a candidate preview overlays onto.

use super::*;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, InputRole, Intent, ObjectId,
    OutputRef, RevisionId, Transformation, WriterId,
};

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

/// One transformation: `inputs` producing one output `object@revision`.
fn txf_envelope(
    writer: WriterId,
    object: ObjectId,
    n: u8,
    inputs: Vec<(ObjectId, RevisionId)>,
) -> (Envelope, RevisionId) {
    let revision = RevisionId::compute(&hash(n), &[]);
    let body = serde_json::to_value(Transformation {
        inputs: inputs
            .into_iter()
            .map(|(object, revision)| InputRef {
                object,
                revision,
                role: InputRole::Direct,
            })
            .collect(),
        outputs: vec![OutputRef {
            object,
            revision: revision.clone(),
            content_hash: hash(n),
            parents: vec![],
        }],
        agent: Agent {
            kind: AgentType::Human,
            id: None,
        },
        intent: Intent {
            kind: "test".into(),
            summary: "read-view".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
    })
    .unwrap();
    (Envelope::create("transformation", writer, body), revision)
}

fn oid() -> ObjectId {
    ObjectId(uuid::Uuid::now_v7())
}

/// Build an index with one edge U -> D, and return (index, U, D).
fn indexed_edge() -> (CoherenceIndex, ObjectId, ObjectId) {
    let (mut index, _) = CoherenceIndex::open_in_memory().expect("index");
    let writer = WriterId(uuid::Uuid::now_v7());
    let u = oid();
    let d = oid();
    let (up, u1) = txf_envelope(writer, u, 1, vec![]);
    let (down, _) = txf_envelope(writer, d, 2, vec![(u, u1)]);
    index.rebuild_from(&[up, down]).expect("rebuild");
    (index, u, d)
}

#[test]
fn upstream_object_is_incident() {
    let (index, u, d) = indexed_edge();
    let inc = index.edges_incident_to(&u).expect("query");
    assert!(!inc.truncated);
    assert_eq!(inc.edges.len(), 1, "U is the upstream of one edge");
    assert_eq!(inc.edges[0].upstream, u);
    assert_eq!(inc.edges[0].downstream, d);
}

#[test]
fn downstream_object_is_incident() {
    let (index, _u, d) = indexed_edge();
    let inc = index.edges_incident_to(&d).expect("query");
    assert_eq!(inc.edges.len(), 1, "D is the downstream of one edge");
    assert_eq!(inc.edges[0].downstream, d);
}

#[test]
fn unrelated_object_has_no_incident_edges() {
    let (index, _u, _d) = indexed_edge();
    let inc = index.edges_incident_to(&oid()).expect("query");
    assert!(inc.edges.is_empty());
    assert!(!inc.truncated);
}

#[test]
fn edge_kind_defaults_to_dependency_in_the_read_view() {
    let (index, u, _d) = indexed_edge();
    let inc = index.edges_incident_to(&u).expect("query");
    assert_eq!(inc.edges[0].kind, OriginEdgeKind::Dependency);
}
