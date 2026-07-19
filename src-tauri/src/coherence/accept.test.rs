// WI-3.4 / SP0 functional + fault gates — operator accept against a real
// WorkspaceKernel (no provider). Commit, idempotent retry, candidate tamper,
// stale-base rejection. The perf gate (20 ms / 16 MiB) is a separate benchmark.

use super::*;
use crate::coherence::dag::Resolved;
use crate::coherence::operator::Candidate;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, InputRef, InputRole, Intent, ObjectId, OutputRef,
    RevisionId, Transformation, WriterId,
};

const NOW: &str = "2026-07-20T00:00:00Z";

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

fn txf_env(
    writer: WriterId,
    object: ObjectId,
    n: u8,
    inputs: Vec<(ObjectId, RevisionId)>,
) -> Envelope {
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
            summary: "seed".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
    })
    .unwrap();
    Envelope::create("transformation", writer, body)
}

/// A kernel seeded with U@u1 -> D@d1 (an edge that a U revision will restale).
fn seeded() -> (
    tempfile::TempDir,
    WorkspaceKernel,
    ObjectId,
    ObjectId,
    RevisionId,
) {
    let dir = tempfile::tempdir().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let mut kernel = WorkspaceKernel::open(dir.path(), writer).unwrap();
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let u1 = RevisionId::compute(&hash(1), &[]);
    kernel
        .append_and_apply(&txf_env(writer, u, 1, vec![]))
        .unwrap();
    kernel
        .append_and_apply(&txf_env(writer, d, 2, vec![(u, u1.clone())]))
        .unwrap();
    (dir, kernel, u, d, u1)
}

#[test]
fn accept_commits_one_revision_and_restales_the_edge() {
    let (_dir, mut kernel, u, _d, u1) = seeded();
    let candidate = Candidate::new(u, "U revised".into(), u1, vec![], "tidy", "s");
    let preview = kernel.index().project_candidates(&candidate, NOW).unwrap();

    let receipt =
        accept_candidate(&mut kernel, &candidate, &preview.structural_classes, NOW).unwrap();
    assert!(receipt.committed);
    assert_eq!(receipt.revision, candidate.revision.as_str());

    // U now resolves to the accepted revision, and the downstream edge is stale.
    assert_eq!(
        kernel.index().resolve_live(&u).unwrap(),
        Resolved::Single(candidate.revision.clone())
    );
    assert_eq!(kernel.index().breakdown(NOW).unwrap().len(), 1);
}

#[test]
fn a_retry_returns_the_original_receipt_and_does_not_double_append() {
    let (_dir, mut kernel, u, _d, u1) = seeded();
    let candidate = Candidate::new(u, "U revised".into(), u1, vec![], "tidy", "s");
    let preview = kernel.index().project_candidates(&candidate, NOW).unwrap();

    let first =
        accept_candidate(&mut kernel, &candidate, &preview.structural_classes, NOW).unwrap();
    assert!(first.committed);

    // A lost-response retry: same candidate. The idem lookup returns the original.
    let retry =
        accept_candidate(&mut kernel, &candidate, &preview.structural_classes, NOW).unwrap();
    assert!(!retry.committed, "retry must not append a second entry");
    assert_eq!(
        retry.entry_id, first.entry_id,
        "returns the ORIGINAL receipt"
    );
}

#[test]
fn a_torn_ledger_entry_is_healed_into_the_index_on_lookup() {
    use crate::coherence::accept_precondition::ClassMap;
    use crate::coherence::operator_accept::operator_accept_idem;
    use crate::coherence::types::FORMAT_VERSION;

    let (_dir, mut kernel, u, _d, u1) = seeded();
    let candidate = Candidate::new(u, "U revised".into(), u1, vec![], "tidy", "s");

    // Simulate a crash BETWEEN the ledger append and the index apply: write the
    // accept transformation (with the deterministic idem) to the LEDGER ONLY.
    let txf = candidate.to_transformation(Agent {
        kind: AgentType::Human,
        id: None,
    });
    let idem = operator_accept_idem("tidy", FORMAT_VERSION, &txf).unwrap();
    let mut env = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(&txf).unwrap(),
    );
    env.idem = idem;
    let torn_id = env.id;
    kernel.ledger().append(&env).unwrap(); // ledger only — index NOT applied
    assert!(
        kernel.index().entry_id_by_idem(&idem).unwrap().is_none(),
        "the index does not have the torn entry yet",
    );

    // Accept finds the ledger entry (idem match) and HEALS the index before
    // returning — the reproject/append are skipped (it's already committed).
    let receipt = accept_candidate(&mut kernel, &candidate, &ClassMap::new(), NOW).unwrap();
    assert!(
        !receipt.committed,
        "returns the torn entry, does not re-append"
    );
    assert_eq!(receipt.entry_id, torn_id);

    // The index is now healed: it knows the entry, and U resolves to the candidate.
    assert_eq!(
        kernel.index().entry_id_by_idem(&idem).unwrap(),
        Some(torn_id),
    );
    assert_eq!(
        kernel.index().resolve_live(&u).unwrap(),
        Resolved::Single(candidate.revision.clone())
    );
}

#[test]
fn a_tampered_candidate_is_rejected() {
    let (_dir, mut kernel, u, _d, u1) = seeded();
    let mut candidate = Candidate::new(u, "U revised".into(), u1, vec![], "tidy", "s");
    let preview = kernel.index().project_candidates(&candidate, NOW).unwrap();

    // Tamper: swap the revision id to a different one (content unchanged).
    candidate.revision = RevisionId::compute(&hash(200), &candidate.parents);
    let err =
        accept_candidate(&mut kernel, &candidate, &preview.structural_classes, NOW).unwrap_err();
    assert!(err.contains("tamper"), "got: {err}");
}

#[test]
fn a_stale_base_is_rejected() {
    let (_dir, mut kernel, u, _d, u1) = seeded();
    let candidate = Candidate::new(u, "U revised".into(), u1.clone(), vec![], "tidy", "s");
    let preview = kernel.index().project_candidates(&candidate, NOW).unwrap();

    // A concurrent writer advances U past the candidate's base BEFORE accept.
    let writer = kernel.writer();
    let mut advance = txf_env(writer, u, 5, vec![]);
    // Make U@u5 a child of u1 so it becomes the new single head.
    let body = serde_json::to_value(Transformation {
        inputs: vec![],
        outputs: vec![OutputRef {
            object: u,
            revision: RevisionId::compute(&hash(5), std::slice::from_ref(&u1)),
            content_hash: hash(5),
            parents: vec![u1.clone()],
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
    .unwrap();
    advance.body = body;
    kernel.append_and_apply(&advance).unwrap();

    let err =
        accept_candidate(&mut kernel, &candidate, &preview.structural_classes, NOW).unwrap_err();
    assert!(err.contains("stale base"), "got: {err}");
}
