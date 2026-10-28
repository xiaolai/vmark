//! Replay refuses what the live writer would never have appended: a
//! checksummed record that breaks a writer invariant is corruption, and a
//! refused record leaves the projection exactly as it was.
//!
//! Edge cases: an empty decision batch, a transition past its reserved
//! `reviewGen` ceiling, a revert outcome on a blocked hunk (but not one
//! recorded under schema v1, which had no blocks; a v2 one on a hunk a v1
//! history blocked is still refused), a `prepared` on a
//! stale parent / wrong preimage / reused revision id, a `committed` whose
//! parent is no longer the head, a repeated legacy id, and a linearization
//! whose kind contradicts its observation's base (a base whose own
//! observation GC dropped may linearize either way).

use std::sync::Arc;

use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::journal_file::{JournalFile, SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::provenance::{Block, BreakReason};
use crate::agent_journal::record::{
    Envelope, GapReason, LegacyAnchor, ObservedRef, Record, SCHEMA_V1, SCHEMA_VERSION,
};
use crate::agent_journal::review::{
    Hunk, HunkKind, HunkState, HunkTransition, MappedSpan, Range, ReviewAction, ReviewEffects,
    ReviewItem, ReviewOp,
};
use crate::agent_journal::test_review_helpers::{two_hunks, MAX};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

/// The records a real writer appended for `build`, decoded.
fn journal(build: impl FnOnce(&Writer, DocId)) -> (Vec<Envelope>, DocId) {
    let dir = tmp();
    let doc = DocId::new();
    {
        let (w, _) = open_fast(dir.path());
        build(&w, doc);
    }
    let opened = JournalFile::open(
        &dir.path().join(JOURNAL_FILE),
        SyncPolicy::None,
        Arc::new(Faults::default()),
    )
    .expect("open journal");
    let envs = opened
        .payloads
        .iter()
        .map(|p| match codec::decode(p).expect("decode") {
            Decoded::Known(env) => *env,
            Decoded::Future { .. } => unreachable!("no future records here"),
        })
        .collect();
    (envs, doc)
}

fn fold(envs: &[Envelope]) -> Projection {
    let mut p = Projection::default();
    for env in envs {
        p.apply(env).expect("a writer-built journal replays");
    }
    p
}

/// A hand-built record appended after `p`'s last generation.
fn next(p: &Projection, txn: TxnId, record: Record) -> Envelope {
    Envelope {
        schema_version: SCHEMA_VERSION,
        seq: p.generation + 1,
        txn,
        at: 1,
        record,
        receipt: None,
    }
}

/// Apply `record` to `p` and require a whole refusal as corruption.
fn refused(p: &mut Projection, txn: TxnId, record: Record) {
    let before = p.clone();
    let env = next(p, txn, record);
    match p.apply(&env) {
        Err(TxnError::Corrupt(_)) => {}
        other => panic!("{:?}: must be corruption, got {other:?}", env.record),
    }
    assert_eq!(*p, before, "a refused record changes nothing");
}

fn accepted(p: &mut Projection, txn: TxnId, record: Record) {
    let env = next(p, txn, record);
    p.apply(&env).expect("a record the writer could append");
}

fn decision(p: &Projection, doc: DocId, action: ReviewAction, items: &[(&HunkId, u64)]) -> Record {
    Record::ReviewDecision {
        doc,
        expected_head: p.head(doc),
        action,
        items: items
            .iter()
            .map(|(h, g)| ReviewItem {
                hunk_id: (*h).clone(),
                expected_review_gen: *g,
            })
            .collect(),
    }
}

fn with_hunks() -> (Projection, DocId, HunkId) {
    let (envs, doc) = journal(|w, doc| {
        two_hunks(w, doc);
    });
    let p = fold(&envs);
    let a = p.docs[&doc].hunks.keys().next().expect("a hunk").clone();
    (p, doc, a)
}

fn block(p: &mut Projection, doc: DocId, id: &HunkId, origin: &str) {
    let h = p
        .docs
        .get_mut(&doc)
        .and_then(|d| d.hunks.get_mut(id))
        .expect("hunk");
    h.span.block = Some(Block::new(BreakReason::SnapshotOnly, origin).expect("origin"));
}

#[test]
fn an_empty_decision_batch_is_corruption() {
    let (mut p, doc, _) = with_hunks();
    let rec = decision(&p, doc, ReviewAction::Keep, &[]);
    refused(&mut p, TxnId::new(), rec);
}

#[test]
fn a_decision_past_its_reserved_review_gen_is_corruption() {
    let (mut p, doc, a) = with_hunks();
    let h = p
        .docs
        .get_mut(&doc)
        .and_then(|d| d.hunks.get_mut(&a))
        .expect("hunk");
    (h.state, h.review_gen) = (HunkState::Kept, MAX - 2);
    // Un-keep moves into `pending`, allowed only up to MAX-3.
    let rec = decision(&p, doc, ReviewAction::Unkeep, &[(&a, MAX - 2)]);
    refused(&mut p, TxnId::new(), rec);
}

#[test]
fn a_revert_outcome_on_a_blocked_hunk_is_corruption() {
    for action in [ReviewAction::Conflicted, ReviewAction::RevertFoundBase] {
        let (mut p, doc, a) = with_hunks();
        block(&mut p, doc, &a, "snapshot");
        let rec = decision(&p, doc, action, &[(&a, 0)]);
        refused(&mut p, TxnId::new(), rec);
    }
}

#[test]
fn a_schema_v1_revert_outcome_on_a_blocked_hunk_still_replays() {
    // Schema v1 had no blocks: replay blocks every live hunk of a v1
    // history, so a v1 journal's revert outcomes must stay readable.
    let (mut p, doc, a) = with_hunks();
    block(&mut p, doc, &a, "schemaV1");
    let rec = decision(&p, doc, ReviewAction::Conflicted, &[(&a, 0)]);
    let env = Envelope {
        schema_version: SCHEMA_V1,
        ..next(&p, TxnId::new(), rec)
    };
    p.apply(&env).expect("a v1 decision replays");
    assert_eq!(p.docs[&doc].hunks[&a].state, HunkState::Conflicted);
}

#[test]
fn a_schema_v2_revert_outcome_on_a_hunk_a_v1_history_blocked_is_corruption() {
    // The live writer refuses every block, whatever its origin, so only the
    // decision record's own schema version exempts it.
    let (mut p, doc, a) = with_hunks();
    block(&mut p, doc, &a, "schemaV1");
    let rec = decision(&p, doc, ReviewAction::Conflicted, &[(&a, 0)]);
    refused(&mut p, TxnId::new(), rec);
}

fn saved() -> (Projection, DocId) {
    let (envs, doc) = journal(|w, doc| {
        human_save(w, doc, "alpha");
    });
    (fold(&envs), doc)
}

fn prepared(doc: DocId, parent: Option<RevisionId>, revision: RevisionId, pre: &str) -> Record {
    Record::Prepared {
        doc,
        parent,
        revision,
        preimage: BlobHash::of_text(pre),
        actor: agent(),
        initiator: agent(),
        tool: "test".into(),
        review_op: ReviewOp::None,
        certificate: None,
    }
}

fn committed(post: &str) -> Record {
    Record::Committed {
        postimage: BlobHash::of_text(post),
        resolves: None,
        provenance: None,
        effects: ReviewEffects::default(),
        addresses: vec![],
    }
}

#[test]
fn a_prepared_off_the_head_is_corruption() {
    let (mut p, doc) = saved();
    refused(
        &mut p,
        TxnId::new(),
        prepared(doc, None, RevisionId::new(), ""),
    );
}

#[test]
fn a_prepared_whose_preimage_is_not_the_head_text_is_corruption() {
    let (mut p, doc) = saved();
    let head = p.head(doc);
    refused(
        &mut p,
        TxnId::new(),
        prepared(doc, head, RevisionId::new(), "other"),
    );
}

#[test]
fn a_prepared_reusing_a_revision_id_is_corruption() {
    let (mut p, doc) = saved();
    let head = p.head(doc);
    let reused = head.expect("a head");
    refused(&mut p, TxnId::new(), prepared(doc, head, reused, "alpha"));
}

#[test]
fn a_commit_whose_parent_is_no_longer_the_head_is_corruption() {
    let (mut p, doc) = saved();
    let head = p.head(doc);
    let (t1, t2) = (TxnId::new(), TxnId::new());
    accepted(&mut p, t1, prepared(doc, head, RevisionId::new(), "alpha"));
    accepted(&mut p, t2, prepared(doc, head, RevisionId::new(), "alpha"));
    accepted(&mut p, t1, committed("beta"));
    // t2 was planned on the old head: committing it forks the chain.
    refused(&mut p, t2, committed("gamma"));
}

#[test]
fn a_repeated_legacy_id_is_corruption() {
    let legacy = |text: &str| Record::LegacyCheckpoint {
        legacy_id: "cp-1".into(),
        preimage: BlobHash::of_text(text),
        postimage: None,
        anchor: LegacyAnchor::FilePath {
            path: "/notes/a.md".into(),
        },
        tool: "legacy".into(),
        description: "before".into(),
        timestamp: 7,
    };
    let mut p = Projection::default();
    accepted(&mut p, TxnId::new(), legacy("first"));
    refused(&mut p, TxnId::new(), legacy("second"));
}

/// A save of "beta" built on `base`, whose text is `pre`.
fn pending(doc: DocId, base: ObservedRef, pre: &str) -> Record {
    Record::PendingObservation {
        doc,
        actor: human(),
        initiator: human(),
        postimage: BlobHash::of_text("beta"),
        observed_parent: base,
        observed_preimage: BlobHash::of_text(pre),
        provenance: None,
    }
}

/// The text of `base` in `saved()`: genesis is empty, an observation (and
/// its tombstone) "beta" as `pending` and `tombstone` record, the rest
/// "alpha".
fn text_of(base: &ObservedRef) -> &'static str {
    match base {
        ObservedRef::Genesis => "",
        ObservedRef::Pending { .. } => "beta",
        _ => "alpha",
    }
}

/// A durable save built on `base`, not yet linearized.
fn pending_on(p: &mut Projection, doc: DocId, base: ObservedRef) -> TxnId {
    let txn = TxnId::new();
    let pre = text_of(&base);
    accepted(p, txn, pending(doc, base, pre));
    txn
}

fn linearization(p: &Projection, doc: DocId, kind: &str, base: &ObservedRef) -> Record {
    let (revision, parent, effects) = (RevisionId::new(), p.head(doc), ReviewEffects::default());
    let observed_preimage = BlobHash::of_text(text_of(base));
    match kind {
        "observed" => Record::ObservedRevision {
            revision,
            parent,
            effects,
        },
        "concurrent" => Record::ConcurrentObservation {
            revision,
            parent,
            observed_parent: base.clone(),
            observed_preimage,
            effects,
        },
        _ => Record::Gap {
            revision,
            parent,
            observed_preimage,
            reason: GapReason::UnjournaledBase,
            effects,
        },
    }
}

#[test]
fn a_linearization_kind_must_match_its_observation_base() {
    let (p0, doc) = saved();
    let head = p0.head(doc).expect("a head");
    let on_head = ObservedRef::Revision { revision: head };
    let behind = ObservedRef::Genesis;
    let unjournaled = ObservedRef::Unjournaled {
        revision: RevisionId::new(),
    };
    let cases = [
        (&on_head, "concurrent"),
        (&on_head, "gap"),
        (&behind, "observed"),
        (&behind, "gap"),
        (&unjournaled, "observed"),
        (&unjournaled, "concurrent"),
    ];
    for (base, kind) in cases {
        let mut p = p0.clone();
        let txn = pending_on(&mut p, doc, base.clone());
        let rec = linearization(&p, doc, kind, base);
        refused(&mut p, txn, rec);
    }
    for (base, kind) in [
        (&on_head, "observed"),
        (&behind, "concurrent"),
        (&unjournaled, "gap"),
    ] {
        let mut p = p0.clone();
        let txn = pending_on(&mut p, doc, base.clone());
        let rec = linearization(&p, doc, kind, base);
        accepted(&mut p, txn, rec);
    }
}

#[test]
fn a_base_whose_observation_was_collected_linearizes_either_way() {
    // GC drops a collected observation's `pendingObservation`, so whether
    // a later save was built on the head is no longer knowable on replay.
    // Its revision's tombstone, under the same transaction, is the evidence.
    let (mut p0, doc) = saved();
    let collected = TxnId::new();
    let head = p0.head(doc);
    accepted(
        &mut p0,
        collected,
        tombstone(doc, head, ReviewOp::None, None),
    );
    let gone = ObservedRef::Pending {
        observation: collected,
    };
    for kind in ["observed", "concurrent"] {
        let mut p = p0.clone();
        let txn = pending_on(&mut p, doc, gone.clone());
        let rec = linearization(&p, doc, kind, &gone);
        accepted(&mut p, txn, rec);
    }
    let mut p = p0.clone();
    let txn = pending_on(&mut p, doc, gone.clone());
    let rec = linearization(&p, doc, "gap", &gone);
    refused(&mut p, txn, rec);
}

#[test]
fn a_concurrent_record_repeats_its_observation_bases_exactly() {
    let (p0, doc) = saved();
    let behind = ObservedRef::Genesis;
    let concurrent = |p: &Projection, base: ObservedRef, pre: &str| Record::ConcurrentObservation {
        revision: RevisionId::new(),
        parent: p.head(doc),
        observed_parent: base,
        observed_preimage: BlobHash::of_text(pre),
        effects: ReviewEffects::default(),
    };
    let other_base = ObservedRef::Revision {
        revision: RevisionId::new(),
    };
    for (base, pre) in [(other_base, "alpha"), (behind.clone(), "other")] {
        let mut p = p0.clone();
        let txn = pending_on(&mut p, doc, behind.clone());
        let rec = concurrent(&p, base, pre);
        refused(&mut p, txn, rec);
    }
}

/// Compaction writes one header, as the first record; any later one could
/// only raise the generation the writer must count past.
#[test]
fn a_journal_header_after_the_first_record_is_corruption() {
    let header = |floor: u64| Record::JournalHeader {
        generation_floor: floor,
    };
    let (mut p, _) = saved();
    let floor = p.generation + 1_000;
    refused(&mut p, TxnId::new(), header(floor));
    let mut fresh = Projection::default();
    accepted(&mut fresh, TxnId::new(), header(5));
    assert_eq!(fresh.generation, 5, "a leading header raises the floor");
    refused(&mut fresh, TxnId::new(), header(9));
}

/// A header at seq 0 with floor 0 leaves every counter at its default; the
/// projection still knows a record applied, so a second header is refused.
#[test]
fn a_second_header_after_a_zero_header_is_corruption() {
    let header = |seq: u64, floor: u64| Envelope {
        schema_version: SCHEMA_VERSION,
        seq,
        txn: TxnId::new(),
        at: 1,
        record: Record::JournalHeader {
            generation_floor: floor,
        },
        receipt: None,
    };
    let mut p = Projection::default();
    p.apply(&header(0, 0)).expect("a leading header");
    let before = p.clone();
    assert!(
        matches!(p.apply(&header(0, 0)), Err(TxnError::Corrupt(_))),
        "a second zero header"
    );
    assert!(
        matches!(p.apply(&header(1, 9)), Err(TxnError::Corrupt(_))),
        "a second header that raises the floor"
    );
    assert_eq!(p, before, "a refused header changes nothing");
}

/// A collected revision's record, as the collector writes it.
fn tombstone(
    doc: DocId,
    parent: Option<RevisionId>,
    review_op: ReviewOp,
    attached_to: Option<HunkId>,
) -> Record {
    Record::Tombstone {
        doc,
        revision: RevisionId::new(),
        parent,
        actor: crate::agent_journal::actor::Actor::Human,
        preimage: None,
        postimage: BlobHash::of_text("beta"),
        review_op,
        hunks: vec![],
        transitions: vec![],
        attached_to,
        addresses: vec![],
    }
}

#[test]
fn a_tombstone_off_the_head_is_corruption() {
    let (mut p, doc) = saved();
    let head = p.head(doc);
    refused(
        &mut p,
        TxnId::new(),
        tombstone(doc, None, ReviewOp::None, None),
    );
    refused(
        &mut p,
        TxnId::new(),
        tombstone(doc, Some(RevisionId::new()), ReviewOp::None, None),
    );
    accepted(
        &mut p,
        TxnId::new(),
        tombstone(doc, head, ReviewOp::None, None),
    );
    // The first record of its document starts at genesis.
    accepted(
        &mut p,
        TxnId::new(),
        tombstone(DocId::new(), None, ReviewOp::None, None),
    );
}

#[test]
fn a_tombstone_attached_to_anything_but_its_reverted_hunk_is_corruption() {
    let (mut p, doc, a) = with_hunks();
    let head = p.head(doc);
    let revert = ReviewOp::HunkRevert {
        hunk_id: a.clone(),
        expected_review_gen: 0,
    };
    let other = HunkId("h-other".into());
    for (op, attached) in [
        (revert.clone(), None),
        (revert.clone(), Some(other.clone())),
        (ReviewOp::None, Some(a.clone())),
    ] {
        refused(&mut p, TxnId::new(), tombstone(doc, head, op, attached));
    }
    accepted(&mut p, TxnId::new(), tombstone(doc, head, revert, Some(a)));
}

/// A save's base is replayed as the writer resolved it: a revision or an
/// observation of the same document, whose text is the observed preimage,
/// and genesis is empty text. Only a base replay cannot see is let through:
/// a commit not yet durable at capture, or an observation GC dropped (its
/// revision's tombstone, under the same transaction, is the evidence).
#[test]
fn a_pending_observation_must_name_a_base_of_its_document_with_its_text() {
    let (mut p0, doc) = saved();
    let head = p0.head(doc).expect("a head");
    let elsewhere = DocId::new();
    accepted(
        &mut p0,
        TxnId::new(),
        tombstone(elsewhere, None, ReviewOp::None, None),
    );
    let foreign = p0.head(elsewhere).expect("a foreign head");
    let known = pending_on(&mut p0, doc, ObservedRef::Revision { revision: head });
    let foreign_obs = TxnId::new();
    accepted(
        &mut p0,
        foreign_obs,
        pending(elsewhere, ObservedRef::Genesis, ""),
    );
    let revision = |revision| ObservedRef::Revision { revision };
    let unjournaled = |revision| ObservedRef::Unjournaled { revision };
    let observation = |observation| ObservedRef::Pending { observation };
    for (base, pre) in [
        (revision(head), "other"),
        (revision(foreign), "beta"),
        (revision(RevisionId::new()), "alpha"),
        (unjournaled(head), "other"),
        (unjournaled(foreign), "beta"),
        (ObservedRef::Genesis, "alpha"),
        (observation(known), "alpha"),
        (observation(foreign_obs), "beta"),
        // No compaction dropped it: a fresh projection's absent observation.
        (observation(TxnId::new()), "anything"),
    ] {
        let mut p = p0.clone();
        refused(&mut p, TxnId::new(), pending(doc, base, pre));
    }
    for (base, pre) in [
        (revision(head), "alpha"),
        (unjournaled(head), "alpha"),
        (unjournaled(RevisionId::new()), "anything"),
        (ObservedRef::Genesis, ""),
        (observation(known), "beta"),
    ] {
        let mut p = p0.clone();
        accepted(&mut p, TxnId::new(), pending(doc, base, pre));
    }
    // Compaction evidence: the collector dropped the observation's record
    // and kept its revision as a tombstone under the same transaction.
    let collected = TxnId::new();
    let mut p = p0.clone();
    let head = p.head(doc);
    accepted(
        &mut p,
        collected,
        tombstone(doc, head, ReviewOp::None, None),
    );
    let mut other_doc = p.clone();
    // The tombstone keeps the observation's postimage ("beta"): a save on
    // it observed that text, nothing else.
    refused(
        &mut p,
        TxnId::new(),
        pending(doc, observation(collected), "x"),
    );
    accepted(
        &mut p,
        TxnId::new(),
        pending(doc, observation(collected), "beta"),
    );
    refused(
        &mut other_doc,
        TxnId::new(),
        pending(elsewhere, observation(collected), "beta"),
    );
}

/// A collected revision on `p`'s head of `doc`, carrying `effects`.
fn tombstone_with(
    p: &Projection,
    doc: DocId,
    revision: RevisionId,
    review_op: ReviewOp,
    effects: ReviewEffects,
) -> Record {
    Record::Tombstone {
        doc,
        revision,
        parent: p.head(doc),
        actor: human(),
        preimage: None,
        postimage: BlobHash::of_text("beta"),
        review_op,
        hunks: effects.new_hunks,
        transitions: effects.transitions,
        attached_to: None,
        addresses: vec![],
    }
}

/// A hunk of `revision` on `base`, its id the canonical one.
fn hunk_of(base: Option<RevisionId>, revision: RevisionId, kind: HunkKind) -> Hunk {
    let r = Range { start: 0, end: 1 };
    let (bh, th) = (BlobHash::of_text("a"), BlobHash::of_text("b"));
    Hunk {
        id: Hunk::compute_id(base, revision, r, r, &bh, &th).expect("an id"),
        kind,
        base,
        target: revision,
        base_range: r,
        target_range: r,
        base_text_hash: bh,
        target_text_hash: th,
    }
}

/// Replay holds a record's effects to the writer's structural rules
/// (`effects_rules`): a transition only to the target its op captures, new
/// hunks only as its op makes them and of this revision, on this parent,
/// under their canonical id.
#[test]
fn replay_refuses_transitions_and_new_hunks_the_writer_would_not_make() {
    let (p0, doc, a) = with_hunks();
    let head = p0.head(doc);
    let rev = RevisionId::new();
    let to = |to| ReviewEffects {
        transitions: vec![HunkTransition {
            hunk_id: a.clone(),
            expected_review_gen: 0,
            to,
        }],
        ..Default::default()
    };
    let hunks = |h: Hunk| ReviewEffects {
        new_hunks: vec![h],
        ..Default::default()
    };
    let mut forged = hunk_of(head, rev, HunkKind::Change);
    forged.id = HunkId("h-forged".into());
    let refused_cases = [
        (ReviewOp::None, to(HunkState::Superseded)),
        (ReviewOp::None, to(HunkState::Settled)),
        (ReviewOp::Review, to(HunkState::ResolvedByHumanEdit)),
        (ReviewOp::None, hunks(hunk_of(head, rev, HunkKind::Change))),
        (
            ReviewOp::Review,
            hunks(hunk_of(head, rev, HunkKind::Restore)),
        ),
        (
            ReviewOp::Review,
            hunks(hunk_of(head, RevisionId::new(), HunkKind::Change)),
        ),
        (
            ReviewOp::Review,
            hunks(hunk_of(None, rev, HunkKind::Change)),
        ),
        (ReviewOp::Review, hunks(forged)),
    ];
    for (op, effects) in refused_cases {
        let mut p = p0.clone();
        let rec = tombstone_with(&p, doc, rev, op, effects);
        refused(&mut p, TxnId::new(), rec);
    }
    for (op, effects) in [
        (ReviewOp::None, to(HunkState::ResolvedByHumanEdit)),
        (ReviewOp::Review, to(HunkState::Superseded)),
        (
            ReviewOp::Review,
            hunks(hunk_of(head, rev, HunkKind::Change)),
        ),
    ] {
        let mut p = p0.clone();
        let rec = tombstone_with(&p, doc, rev, op, effects);
        accepted(&mut p, TxnId::new(), rec);
    }
}

/// A live revision record carries one span for every hunk that was not
/// settled before it — no fewer, no repeats. (A tombstone carries none:
/// the collector drops spans.)
#[test]
fn replay_refuses_a_revision_whose_spans_do_not_cover_the_live_hunks() {
    let (p0, doc, a) = with_hunks();
    let head = p0.head(doc).expect("a head");
    let live: Vec<MappedSpan> = p0.docs[&doc]
        .hunks
        .values()
        .map(|h| h.span.clone())
        .collect();
    let one = |id: &HunkId| live.iter().find(|s| s.hunk_id == *id).unwrap().clone();
    let observed = |spans: Vec<MappedSpan>| Record::ObservedRevision {
        revision: RevisionId::new(),
        parent: Some(head),
        effects: ReviewEffects {
            spans,
            ..Default::default()
        },
    };
    let base = ObservedRef::Revision { revision: head };
    let pre = p0.revisions[&head].postimage.clone();
    let save = |p: &mut Projection| {
        let txn = TxnId::new();
        let mut rec = pending(doc, base.clone(), "");
        if let Record::PendingObservation {
            observed_preimage, ..
        } = &mut rec
        {
            *observed_preimage = pre.clone();
        }
        accepted(p, txn, rec);
        txn
    };
    let mut doubled = live.clone();
    doubled.push(one(&a));
    for spans in [vec![], vec![one(&a)], doubled] {
        let mut p = p0.clone();
        let txn = save(&mut p);
        refused(&mut p, txn, observed(spans));
    }
    let mut p = p0.clone();
    let txn = save(&mut p);
    accepted(&mut p, txn, observed(live));
}

/// Replay holds a record's new hunks to the slot limit the writer admits
/// them under (`review_rules::new_hunks_fit`): more canonical Review hunks
/// than the free agent slots is a journal the writer could not have made.
#[test]
fn replay_refuses_more_new_review_hunks_than_the_free_agent_slots() {
    use crate::agent_journal::review_rules::AGENT_SLOT_LIMIT;
    let (p0, doc, _) = with_hunks();
    let head = p0.head(doc);
    let free = AGENT_SLOT_LIMIT - p0.docs[&doc].non_settled();
    let rev = RevisionId::new();
    let canonical = |i: usize| {
        let r = Range {
            start: i as u64,
            end: i as u64 + 1,
        };
        let (bh, th) = (BlobHash::of_text("a"), BlobHash::of_text("b"));
        Hunk {
            id: Hunk::compute_id(head, rev, r, r, &bh, &th).expect("an id"),
            kind: HunkKind::Change,
            base: head,
            target: rev,
            base_range: r,
            target_range: r,
            base_text_hash: bh,
            target_text_hash: th,
        }
    };
    let review = |n: usize| ReviewEffects {
        new_hunks: (0..n).map(canonical).collect(),
        ..Default::default()
    };
    let mut p = p0.clone();
    let rec = tombstone_with(&p, doc, rev, ReviewOp::Review, review(free + 1));
    refused(&mut p, TxnId::new(), rec);
    let rec = tombstone_with(&p, doc, rev, ReviewOp::Review, review(free));
    accepted(&mut p, TxnId::new(), rec);
}
