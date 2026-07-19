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

// SP0 perf-gate MECHANISM: the read-view is bounded by the changed object's
// DEGREE, not the corpus size. This is what keeps the preview O(affected set),
// not O(all edges) — the property the 20 ms / 16 MiB envelope rests on. (The
// absolute figure at §10's 500k-edge scale is a separate benchmark harness.)
#[test]
fn incident_query_is_bounded_by_degree_not_corpus_size() {
    let (mut index, _) = CoherenceIndex::open_in_memory().expect("index");
    let writer = WriterId(uuid::Uuid::now_v7());

    // 200 UNRELATED edges: each a distinct downstream deriving from a distinct
    // upstream, none touching our target object.
    let mut entries = Vec::new();
    for i in 0..200u8 {
        let up = oid();
        let down = oid();
        let (up_e, up_rev) = txf_envelope(writer, up, 100u8.wrapping_add(i), vec![]);
        let (down_e, _) = txf_envelope(writer, down, 50u8.wrapping_add(i), vec![(up, up_rev)]);
        entries.push(up_e);
        entries.push(down_e);
    }
    // The target X with exactly TWO incident edges.
    let x = oid();
    let a = oid();
    let (x_e, x_rev) = txf_envelope(writer, x, 1, vec![]);
    let (a_e, _) = txf_envelope(writer, a, 2, vec![(x, x_rev.clone())]); // X upstream
    let b = oid();
    let (b_e, b_rev) = txf_envelope(writer, b, 3, vec![]);
    let (x2_e, _) = txf_envelope(writer, x, 4, vec![(b, b_rev)]); // X downstream (new rev)
    entries.extend([x_e, a_e, b_e, x2_e]);
    index.rebuild_from(&entries).expect("rebuild");

    // 400+ edges in the corpus, but X is incident to only its own.
    let inc = index.edges_incident_to(&x).expect("query");
    assert!(!inc.truncated);
    assert_eq!(
        inc.edges.len(),
        2,
        "the read-view returns only X's incident edges, independent of the 200 unrelated ones",
    );
    for e in &inc.edges {
        assert!(
            e.upstream == x || e.downstream == x,
            "every returned edge is incident to X",
        );
    }
}
