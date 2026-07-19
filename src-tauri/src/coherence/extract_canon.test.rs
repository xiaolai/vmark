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

// WI-4.4 — facet-level granularity: two facet carriers, each with its own
// conformer; editing ONE facet carrier stales only that facet's conformer, not
// the other's. This is the false-positive-staleness knob (§4 granularity lever).
#[test]
fn a_facet_carrier_change_stales_only_its_own_conformers() {
    const NOW_LATE: &str = "2026-07-21T00:00:00Z";
    let dir = tempfile::tempdir().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let mut kernel = WorkspaceKernel::open(dir.path(), writer).unwrap();

    // Two conformers, one per facet.
    let combat_scene = ObjectId(uuid::Uuid::now_v7());
    let lore_scene = ObjectId(uuid::Uuid::now_v7());
    kernel
        .append_and_apply(&seed(writer, combat_scene, 1))
        .unwrap();
    kernel
        .append_and_apply(&seed(writer, lore_scene, 2))
        .unwrap();

    // Two SEPARATE facet carriers, each folding its own conformer.
    let combat_canon = ObjectId(uuid::Uuid::now_v7());
    let lore_canon = ObjectId(uuid::Uuid::now_v7());
    let combat_cs = extract_canon(
        combat_canon,
        "combat rules".into(),
        "magic.combat",
        &[Conformer {
            object: combat_scene,
            content: "a duel".into(),
            base: RevisionId::compute(&hash(1), &[]),
        }],
    );
    let lore_cs = extract_canon(
        lore_canon,
        "lore".into(),
        "magic.lore",
        &[Conformer {
            object: lore_scene,
            content: "a legend".into(),
            base: RevisionId::compute(&hash(2), &[]),
        }],
    );
    for cs in [&combat_cs, &lore_cs] {
        let p = kernel.index().project_group(cs, NOW).unwrap();
        accept_group(&mut kernel, cs, &p, NOW).unwrap();
    }

    // No stale edges yet (fresh conformance).
    assert!(kernel.index().breakdown(NOW).unwrap().is_empty());

    // Edit ONLY the combat facet carrier (a new carrier revision).
    let combat_base = combat_cs[0].revision.clone();
    let revise = crate::coherence::operator::Candidate::new(
        combat_canon,
        "combat rules v2".into(),
        combat_base,
        vec![],
        "tidy",
        "revise combat canon",
    );
    let p = kernel.index().project_candidates(&revise, NOW).unwrap();
    crate::coherence::accept::accept_candidate(&mut kernel, &revise, &p.structural_classes, NOW)
        .unwrap();

    // Only the combat conformer restales; the lore conformer stays fresh.
    let stale = kernel.index().breakdown(NOW_LATE).unwrap();
    assert_eq!(stale.len(), 1, "only the combat facet's conformer restales");
    assert_eq!(stale[0].downstream, combat_scene);
    assert_ne!(stale[0].downstream, lore_scene);
}
