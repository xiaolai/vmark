// WI-6.1 — the shared read-model contract. BreakdownProjection reproduces the
// breakdown's rows in the shared shape (behaviour-identical), and row_from
// assembles the identical shape from raw parts (the WI-6.2 surfaces' helper).

use super::*;
use crate::coherence::edge_kind::OriginEdgeKind;
use crate::coherence::index::CoherenceIndex;
use crate::coherence::project::EdgeState;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, InputRole, Intent, OutputRef,
    Transformation, WriterId,
};

const NOW: &str = "2026-07-20T00:00:00Z";

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

fn txf(writer: WriterId, object: ObjectId, n: u8, inputs: Vec<(ObjectId, RevisionId)>) -> Envelope {
    let revision = RevisionId::compute(&hash(n), &[]);
    Envelope::create(
        "transformation",
        writer,
        serde_json::to_value(Transformation {
            inputs: inputs
                .into_iter()
                .map(|(object, revision)| InputRef {
                    object,
                    revision,
                    role: InputRole::Direct,
                    kind: OriginEdgeKind::Dependency,
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
                summary: "read-model".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .unwrap(),
    )
}

/// U advances u1->u2 with D pinned at u1 → one version-stale edge in breakdown.
fn stale_index() -> CoherenceIndex {
    let (mut index, _) = CoherenceIndex::open_in_memory().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let u1 = RevisionId::compute(&hash(1), &[]);
    index
        .rebuild_from(&[
            txf(writer, u, 1, vec![]),
            txf(writer, d, 2, vec![(u, u1.clone())]),
            {
                // U -> u2 (advance) so the D edge is stale.
                let u2 = RevisionId::compute(&hash(3), std::slice::from_ref(&u1));
                Envelope::create(
                    "transformation",
                    writer,
                    serde_json::to_value(Transformation {
                        inputs: vec![],
                        outputs: vec![OutputRef {
                            object: u,
                            revision: u2,
                            content_hash: hash(3),
                            parents: vec![u1],
                        }],
                        agent: Agent {
                            kind: AgentType::Human,
                            id: None,
                        },
                        intent: Intent {
                            kind: "test".into(),
                            summary: "advance".into(),
                            prompt_hash: None,
                        },
                        confidence: Confidence::Exact,
                    })
                    .unwrap(),
                )
            },
        ])
        .unwrap();
    index
}

#[test]
fn breakdown_projection_matches_the_breakdown_rows() {
    let index = stale_index();
    let raw = index.breakdown(NOW).unwrap();
    let rows = BreakdownProjection.rows(&index, NOW).unwrap();

    assert_eq!(rows.len(), raw.len());
    assert_eq!(rows.len(), 1, "one version-stale edge");
    let (row, r) = (&rows[0], &raw[0]);
    assert_eq!(row.txf, r.txf.to_string());
    assert_eq!(row.upstream, r.upstream);
    assert_eq!(row.downstream, r.downstream);
    assert_eq!(row.state, "version-stale");
    assert_eq!(row.kind, "dependency");
}

#[test]
fn incident_projection_emits_rows_for_incident_edges() {
    // Build U -> D with U advanced (stale), and project via IncidentProjection{U}.
    let (mut index, _) = CoherenceIndex::open_in_memory().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let u1 = RevisionId::compute(&hash(1), &[]);
    let u2 = RevisionId::compute(&hash(3), std::slice::from_ref(&u1));
    index
        .rebuild_from(&[
            txf(writer, u, 1, vec![]),
            txf(writer, d, 2, vec![(u, u1.clone())]),
            Envelope::create(
                "transformation",
                writer,
                serde_json::to_value(Transformation {
                    inputs: vec![],
                    outputs: vec![OutputRef {
                        object: u,
                        revision: u2,
                        content_hash: hash(3),
                        parents: vec![u1],
                    }],
                    agent: Agent {
                        kind: AgentType::Human,
                        id: None,
                    },
                    intent: Intent {
                        kind: "t".into(),
                        summary: "adv".into(),
                        prompt_hash: None,
                    },
                    confidence: Confidence::Exact,
                })
                .unwrap(),
            ),
        ])
        .unwrap();

    let rows = IncidentProjection { object: u }.rows(&index, NOW).unwrap();
    assert_eq!(rows.len(), 1, "the U->D edge is incident to U");
    assert_eq!(rows[0].downstream, d);
    assert_eq!(rows[0].state, "version-stale");
    // Same trait, same row shape as BreakdownProjection.
    let bd = BreakdownProjection.rows(&index, NOW).unwrap();
    assert_eq!(rows[0].txf, bd[0].txf);
    assert_eq!(rows[0].state, bd[0].state);
}

#[test]
fn row_from_assembles_the_shared_shape() {
    let up = ObjectId(uuid::Uuid::from_u128(1));
    let down = ObjectId(uuid::Uuid::from_u128(2));
    let rev = RevisionId::compute(&hash(9), &[]);
    let row = row_from(
        &uuid::Uuid::from_u128(3),
        0,
        up,
        down,
        &rev,
        &EdgeState::VersionStale,
        OriginEdgeKind::Conformance,
    );
    assert_eq!(row.upstream, up);
    assert_eq!(row.downstream, down);
    assert_eq!(row.state, "version-stale");
    assert_eq!(row.kind, "conformance");
}

#[test]
fn coherence_row_serializes_camel_case() {
    let row = row_from(
        &uuid::Uuid::from_u128(1),
        0,
        ObjectId(uuid::Uuid::from_u128(1)),
        ObjectId(uuid::Uuid::from_u128(2)),
        &RevisionId::compute(&hash(1), &[]),
        &EdgeState::VersionStale,
        OriginEdgeKind::Dependency,
    );
    let json = serde_json::to_string(&row).unwrap();
    assert!(json.contains("downstreamRev"));
    assert!(json.contains("upstreamPath"));
}
