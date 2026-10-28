// WI-AL1.2 — shared harness for the journal suites
//! Shared harness: writers on temp dirs, actors, and a minimal stand-in for
//! the frontend worker: certified provenance built from explicit edits,
//! spans and capture transitions derived through `crate::agent_journal::span_map`.
#![allow(dead_code)]

use std::sync::Arc;

use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::{BlobHash, ConnectionId, DocId, RevisionId, TxnId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::provenance::{Provenance, ProvenancePayload, Section, PROVENANCE_CAP};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{Hunk, HunkKind, MappedSpan, Range, ReviewEffects, ReviewOp};
use crate::agent_journal::span_map::{derive, DeriveCtx, Derived};
use crate::agent_journal::text::utf16_slices;
use crate::agent_journal::writer::{
    CommitRequest, LinearizeRequest, ObserveRequest, PrepareRequest, Writer, WriterConfig,
};

pub fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

pub fn config(dir: &std::path::Path, sync: SyncPolicy) -> (WriterConfig, Arc<Faults>) {
    let faults = Arc::new(Faults::default());
    (
        WriterConfig {
            dir: dir.to_path_buf(),
            sync,
            faults: faults.clone(),
        },
        faults,
    )
}

pub fn open(dir: &std::path::Path) -> (Writer, Arc<Faults>) {
    open_with(dir, SyncPolicy::Full)
}

pub fn open_fast(dir: &std::path::Path) -> (Writer, Arc<Faults>) {
    open_with(dir, SyncPolicy::None)
}

pub fn open_with(dir: &std::path::Path, sync: SyncPolicy) -> (Writer, Arc<Faults>) {
    let (cfg, faults) = config(dir, sync);
    let (w, _) = Writer::open(cfg).expect("open writer");
    (w, faults)
}

pub fn agent() -> Actor {
    Actor::Mcp {
        principal: Principal::Provider {
            provider: "claude".into(),
        },
        connection_id: ConnectionId::new(),
        session_label: Some("spike".into()),
        display_name: Some("Claude Code".into()),
    }
}

pub fn human() -> Actor {
    Actor::Human
}

pub fn prepare_req(
    doc: DocId,
    parent: Option<RevisionId>,
    preimage: &str,
    op: ReviewOp,
) -> PrepareRequest {
    PrepareRequest {
        doc,
        parent,
        preimage: preimage.to_string(),
        actor: agent(),
        initiator: agent(),
        tool: "document.write".into(),
        review_op: op,
        certificate: None,
    }
}

/// One replacement in UTF-16 units: `[at, at+delete)` becomes `insert`.
#[derive(Clone, Copy)]
pub struct Edit {
    pub at: u64,
    pub delete: u64,
    pub insert: u64,
}
impl Edit {
    pub fn none() -> Self {
        Self {
            at: 0,
            delete: 0,
            insert: 0,
        }
    }
}

/// One CodeMirror section for `e`, in the coordinates of the text it edits.
pub fn section(e: Edit) -> Section {
    let (at, del, ins) = (e.at as i64, e.delete as i64, e.insert as i64);
    Section {
        from_a: at,
        to_a: at + del,
        from_b: at,
        to_b: at + ins,
    }
}

fn len16(s: &str) -> i64 {
    s.encode_utf16().count() as i64
}

/// The window of certified edits applied in order (one transaction each).
pub fn window(pre: &str, edits: &[Edit]) -> Provenance {
    let mut p = Provenance::new(len16(pre), PROVENANCE_CAP).expect("window");
    for e in edits {
        p.compose(&[section(*e)]).expect("certified edit");
    }
    p
}

/// The doc's armed epoch, arming one if none is open.
pub fn ensure_epoch(w: &Writer, doc: DocId) -> u64 {
    w.epoch(doc)
        .unwrap_or_else(|| w.arm_epoch(doc).expect("arm epoch"))
}

/// A certified payload `pre → post` through `edits`, based on `basis`.
pub fn payload(
    w: &Writer,
    doc: DocId,
    basis: &str,
    pre: &str,
    post: &str,
    edits: &[Edit],
) -> ProvenancePayload {
    let epoch = ensure_epoch(w, doc).to_string();
    ProvenancePayload::encode(
        &doc.to_string(),
        &epoch,
        basis,
        pre,
        post,
        &window(pre, edits),
    )
    .expect("payload")
}

/// The observed predecessor a window names when its buffer was built on
/// `parent`: that revision, or genesis.
pub fn observed_on(parent: Option<RevisionId>) -> ObservedRef {
    match parent {
        Some(revision) => ObservedRef::Revision { revision },
        None => ObservedRef::Genesis,
    }
}

pub fn basis(parent: Option<RevisionId>) -> String {
    crate::agent_journal::writer_epoch::basis_of(parent)
}

/// Worker stand-in: what a revision with `op`, mapped through `window`,
/// does to every non-settled hunk of `doc`.
pub fn derived(
    w: &Writer,
    doc: DocId,
    op: &ReviewOp,
    window: &Provenance,
    post: &str,
    new_hunks: &[Hunk],
) -> Derived {
    let snap = w.snapshot();
    let empty = Default::default();
    let d = snap.state.docs.get(&doc).unwrap_or(&empty);
    let ctx = DeriveCtx {
        doc: d,
        parent: d.head,
        op,
        window,
        postimage: post,
        new_hunks,
        reverted: None,
    };
    derive(&ctx).expect("derive")
}

/// Spans of every non-settled hunk of `doc` through one certified edit of the head text.
pub fn spans_for(w: &Writer, doc: DocId, postimage: &str, edit: Edit) -> Vec<MappedSpan> {
    let win = window(&head_text(w, doc), &[edit]);
    derived(w, doc, &ReviewOp::Review, &win, postimage, &[]).spans
}

/// The minimal single edit turning `old` into `new` (common prefix/suffix).
pub fn diff_edit(old: &str, new: &str) -> Edit {
    let (a, b): (Vec<u16>, Vec<u16>) = (old.encode_utf16().collect(), new.encode_utf16().collect());
    let pre = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let max_suf = a.len().min(b.len()) - pre;
    let suf = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take(max_suf)
        .take_while(|(x, y)| x == y)
        .count();
    Edit {
        at: pre as u64,
        delete: (a.len() - pre - suf) as u64,
        insert: (b.len() - pre - suf) as u64,
    }
}

pub fn hunk(
    base: Option<RevisionId>,
    target: RevisionId,
    pre: &str,
    post: &str,
    base_range: Range,
    target_range: Range,
    kind: HunkKind,
) -> Hunk {
    let b = utf16_slices(pre, &[base_range]).expect("base range")[0];
    let t = utf16_slices(post, &[target_range]).expect("target range")[0];
    let (bh, th) = (BlobHash::of_text(b), BlobHash::of_text(t));
    Hunk {
        id: Hunk::compute_id(base, target, base_range, target_range, &bh, &th)
            .expect("valid ranges"),
        kind,
        base,
        target,
        base_range,
        target_range,
        base_text_hash: bh,
        target_text_hash: th,
    }
}

pub fn r(start: u64, end: u64) -> Range {
    Range { start, end }
}

/// Commit `head → post` through one certified `edit` with `hunks`; spans
/// and capture transitions derived the way the writer derives them.
pub fn commit_req(
    w: &Writer,
    doc: DocId,
    post: &str,
    edit: Edit,
    hunks: Vec<Hunk>,
) -> CommitRequest {
    commit_req_op(w, doc, post, &[edit], hunks, &ReviewOp::Review)
}

pub fn commit_req_op(
    w: &Writer,
    doc: DocId,
    post: &str,
    edits: &[Edit],
    hunks: Vec<Hunk>,
    op: &ReviewOp,
) -> CommitRequest {
    let pre = head_text(w, doc);
    let p = payload(w, doc, &basis(w.head(doc)), &pre, post, edits);
    let d = derived(w, doc, op, &p.accumulator().expect("window"), post, &hunks);
    CommitRequest {
        postimage: post.to_string(),
        resolves: None,
        provenance: Some(p),
        effects: ReviewEffects {
            new_hunks: hunks,
            transitions: d.transitions,
            spans: d.spans,
            algorithm: "spike-1".into(),
        },
    }
}

/// Commit with no worker provenance: the writer records a whole-document
/// barrier (`wholeDocumentWrite` for review, `snapshotOnly` for none,
/// `restore` for a restore).
pub fn barrier_commit_req(
    w: &Writer,
    doc: DocId,
    post: &str,
    hunks: Vec<Hunk>,
    op: &ReviewOp,
) -> CommitRequest {
    let (reason, origin) = match op {
        ReviewOp::Review => (
            crate::agent_journal::provenance::BreakReason::WholeDocumentWrite,
            "agent",
        ),
        ReviewOp::Restore { .. } => (
            crate::agent_journal::provenance::BreakReason::Restore,
            "restore",
        ),
        _ => (
            crate::agent_journal::provenance::BreakReason::SnapshotOnly,
            "snapshot",
        ),
    };
    let win =
        crate::agent_journal::writer_epoch::whole_window(&head_text(w, doc), post, reason, origin)
            .expect("barrier");
    let d = derived(w, doc, op, &win, post, &hunks);
    CommitRequest {
        postimage: post.to_string(),
        resolves: None,
        provenance: None,
        effects: ReviewEffects {
            new_hunks: hunks,
            transitions: d.transitions,
            spans: d.spans,
            algorithm: "spike-1".into(),
        },
    }
}

/// An agent change `pre → post` on `doc` that adds one hunk covering the
/// edit. Returns (txn, revision).
pub fn agent_change(
    w: &Writer,
    doc: DocId,
    pre: &str,
    post: &str,
    edit: Edit,
) -> (TxnId, RevisionId) {
    let head = w.head(doc);
    let p = w
        .prepare(prepare_req(doc, head, pre, ReviewOp::Review))
        .expect("prepare");
    let h = hunk(
        head,
        p.revision,
        pre,
        post,
        r(edit.at, edit.at + edit.delete),
        r(edit.at, edit.at + edit.insert),
        HunkKind::Change,
    );
    let out = w
        .commit(p.txn, commit_req(w, doc, post, edit, vec![h]))
        .expect("commit");
    assert!(out.durable);
    (p.txn, out.revision)
}

/// `n` disjoint one-character hunks turning `n` 'y's into `n` 'x's. The
/// 'y' text is first recorded as a human save when the head holds anything
/// else, because a prepare's preimage must be the head text (R3).
pub fn seed_hunks(w: &Writer, doc: DocId, n: u64) -> String {
    let pre = "y".repeat(n as usize);
    let post = "x".repeat(n as usize);
    if head_text(w, doc) != pre {
        human_save(w, doc, &pre);
    }
    let head = w.head(doc);
    let p = w
        .prepare(prepare_req(doc, head, &pre, ReviewOp::Review))
        .expect("prepare");
    let hunks = (0..n)
        .map(|i| {
            hunk(
                head,
                p.revision,
                &pre,
                &post,
                r(i, i + 1),
                r(i, i + 1),
                HunkKind::Change,
            )
        })
        .collect();
    let edit = Edit {
        at: 0,
        delete: n,
        insert: n,
    };
    w.commit(p.txn, commit_req(w, doc, &post, edit, hunks))
        .expect("seed commit");
    post
}

pub fn hunk_ids(w: &Writer, doc: DocId) -> Vec<crate::agent_journal::ids::HunkId> {
    w.snapshot().state.docs[&doc]
        .hunks
        .keys()
        .cloned()
        .collect()
}

/// The head's text (`""` before the first revision — the genesis baseline).
pub fn head_text(w: &Writer, doc: DocId) -> String {
    match w.head(doc) {
        None => String::new(),
        Some(h) => w
            .blob_text(&w.snapshot().state.revisions[&h].postimage)
            .expect("head text"),
    }
}

/// A human save of `text` on top of the head, linearized at once, with the
/// certified minimal edit as its provenance. This is how unsaved buffer
/// text becomes a recorded baseline (R3).
pub fn human_save(w: &Writer, doc: DocId, text: &str) -> RevisionId {
    let edit = diff_edit(&head_text(w, doc), text);
    human_edit(w, doc, text, &[edit])
}

/// A human save through certified `edits` (applied in order to the head text).
pub fn human_edit(w: &Writer, doc: DocId, text: &str, edits: &[Edit]) -> RevisionId {
    let head = w.head(doc);
    let p = payload(w, doc, &basis(head), &head_text(w, doc), text, edits);
    observe(w, doc, text, Some(p));
    linearize(w, doc).revision
}

/// A snapshot-only save (no provenance): a `snapshotOnly` barrier.
pub fn snapshot_save(w: &Writer, doc: DocId, text: &str) -> RevisionId {
    observe(w, doc, text, None);
    linearize(w, doc).revision
}

/// A human capture on top of the head.
pub fn observe(w: &Writer, doc: DocId, text: &str, provenance: Option<ProvenancePayload>) -> TxnId {
    let observed_parent =
        w.head(doc)
            .map_or(ObservedRef::Genesis, |revision| ObservedRef::Revision {
                revision,
            });
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: text.into(),
        observed_parent,
        provenance,
    })
    .expect("observe")
    .observation
}

/// Linearization effects for the oldest pending observation, derived the
/// way the writer derives them.
pub fn linearize_effects(w: &Writer, doc: DocId) -> ReviewEffects {
    let snap = w.snapshot();
    let obs = snap.state.docs[&doc].pending[0];
    let post = w
        .blob_text(&snap.state.observations[&obs].postimage)
        .expect("post");
    let (win, _) = crate::agent_journal::writer::linearization_window(
        &snap.state,
        doc,
        obs,
        &head_text(w, doc),
        &post,
    )
    .expect("window");
    let d = derived(w, doc, &ReviewOp::None, &win, &post, &[]);
    ReviewEffects {
        spans: d.spans,
        transitions: d.transitions,
        ..Default::default()
    }
}

pub fn linearize(w: &Writer, doc: DocId) -> crate::agent_journal::writer::Linearized {
    let effects = linearize_effects(w, doc);
    w.linearize_next(
        doc,
        LinearizeRequest {
            expected_head: w.head(doc),
            effects,
        },
    )
    .expect("linearize")
    .expect("pending")
}

/// Run `a` with `b` injected just before `a`'s `k`-th writer-lock
/// acquisition (counted from 1), on another thread, while `a` holds no
/// lock: `b` runs to completion inside that gap. When `a` takes fewer than
/// `k` locks, `b` runs after `a` returns. Returns both results and whether
/// `b` ran inside `a`.
pub fn interleave<RA, RB: Send>(
    faults: &Faults,
    k: u32,
    a: impl FnOnce() -> RA,
    b: impl FnOnce() -> RB + Send,
) -> (RA, RB, bool) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    let (go_tx, go_rx) = mpsc::channel::<()>();
    let (done_tx, done_rx) = mpsc::channel::<()>();
    let fired = Arc::new(AtomicBool::new(false));
    std::thread::scope(|s| {
        let competitor = s.spawn(move || {
            // Err: the hook was disarmed unfired, so `a` has returned.
            let _ = go_rx.recv();
            let out = b();
            let _ = done_tx.send(());
            out
        });
        let flag = fired.clone();
        faults.before_nth_lock(
            k,
            Some(Box::new(move || {
                flag.store(true, Ordering::SeqCst);
                go_tx.send(()).expect("competitor waiting");
                done_rx.recv().expect("competitor finished");
            })),
        );
        let ra = a();
        faults.before_nth_lock(0, None);
        let rb = competitor.join().expect("competitor panicked");
        (ra, rb, fired.load(Ordering::SeqCst))
    })
}
