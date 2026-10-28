// WI-AL2.2b — the staged revert admission against a real append and replay with the same allocated ids: a revert staged on the clone (a pending chain linearized then prepared; a pending chain then a conflicted decision; a buffer built on an older revision, refused AMBIGUOUS_REVERT as a parent mismatch; a stale parent, refused) leaves exactly the projection that its items, appended one frame each and replayed, produce — head, every hunk's state, reviewGen, span, block and lastCertified, the observation state — and the twin plans the same revert postimage
//! R29's differential test, on R44's mechanism: staging applies each item
//! with the real reducer to a clone and swaps it in; here the same items,
//! ids and seqs unchanged, go through the plain path — one frame each —
//! and a cold replay.

use std::path::Path;

use super::revert_support::*;
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::frame;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, TxnId};
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::provenance::BreakReason;
use crate::agent_journal::record::{Envelope, ObservedRef, Record};
use crate::agent_journal::revert_gate::RevertDecision;
use crate::agent_journal::review::{HunkState, ReviewAction};
use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::{ObserveRequest, Writer};

fn envelopes(dir: &Path) -> Vec<Envelope> {
    let bytes = std::fs::read(dir.join(JOURNAL_FILE)).expect("journal");
    frame::scan(&bytes)
        .expect("frames")
        .frames
        .iter()
        .map(|f| match codec::decode(&f.payload).expect("decode") {
            Decoded::Known(env) => *env,
            Decoded::Future { version, .. } => panic!("future v{version}"),
        })
        .collect()
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("mkdir");
    for entry in std::fs::read_dir(from).expect("read dir") {
        let entry = entry.expect("entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("type").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).expect("copy");
        }
    }
}

/// A twin of `dir` whose journal holds every admission's items as frames
/// of their own, ids and seqs unchanged: the plain append path.
fn split_twin(dir: &Path) -> (tempfile::TempDir, usize) {
    let twin = tmp();
    copy_dir(dir, twin.path());
    let mut bytes = Vec::new();
    let mut split = 0;
    for env in envelopes(dir) {
        match env.record {
            Record::Admission { items } => {
                split += 1;
                for item in &items {
                    bytes.extend(frame::encode(&codec::encode(item)));
                }
            }
            _ => bytes.extend(frame::encode(&codec::encode(&env))),
        }
    }
    std::fs::write(twin.path().join(JOURNAL_FILE), bytes).expect("rewrite");
    (twin, split)
}

/// End `doc`'s open transaction and epoch, as a clean shutdown does, so a
/// reopen recovers and appends nothing.
fn quiesce(w: &Writer, doc: DocId) {
    if let Some(r) = w.reservation(doc) {
        w.abort(r.txn, "edited").expect("abort");
    }
    if let Some(epoch) = w.epoch(doc) {
        w.close_epoch(doc, epoch).expect("close epoch");
    }
}

/// The live projection equals a cold replay of the journal and of its
/// split twin; returns the twin, reopened. `admissions` is how many
/// admission frames the journal must hold.
fn assert_differential(
    dir: &Path,
    w: Writer,
    doc: DocId,
    admissions: usize,
) -> (tempfile::TempDir, Writer) {
    quiesce(&w, doc);
    let live: Projection = w.lock().proj.clone();
    drop(w);
    let (whole, _) = Writer::open(config(dir, SyncPolicy::Full).0).expect("reopen");
    assert_eq!(
        whole.lock().proj,
        live,
        "live = replay of the admission frame"
    );
    drop(whole);
    let (twin, split) = split_twin(dir);
    assert_eq!(split, admissions, "admission frames split");
    let (t, _) = Writer::open(config(twin.path(), SyncPolicy::Full).0).expect("open twin");
    {
        let replayed = &t.lock().proj;
        assert_eq!(
            replayed, &live,
            "live = the items appended one by one, replayed"
        );
        let d = &replayed.docs[&doc];
        assert!(d.pending.is_empty(), "the chain is linearized");
    }
    (twin, t)
}

/// A certified pending capture of `text` through `edits`, built on `on`.
fn pending(
    w: &Writer,
    doc: DocId,
    on: ObservedRef,
    pre: &str,
    text: &str,
    edits: &[Edit],
) -> TxnId {
    let basis = crate::agent_journal::writer_epoch::observed_basis(&on);
    let p = payload(w, doc, &basis, pre, text, edits);
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: text.into(),
        observed_parent: on,
        provenance: Some(p),
    })
    .expect("observe")
    .observation
}

/// "xx" with hunks A [0,1) and B [1,2), then two certified pending saves
/// chained on each other: `second` is built on `first`.
fn chain(w: &Writer, doc: DocId, first: (&str, Edit), second: (&str, Edit)) -> (HunkId, TxnId) {
    let (a, _) = two_hunks(w, doc);
    let p1 = pending(w, doc, observed_on(w.head(doc)), "xx", first.0, &[first.1]);
    let p2 = pending(
        w,
        doc,
        ObservedRef::Pending { observation: p1 },
        first.0,
        second.0,
        &[second.1],
    );
    assert_eq!(w.lock().proj.docs[&doc].pending.len(), 2, "a pending chain");
    (a, p2)
}

fn ins(at: u64) -> Edit {
    Edit {
        at,
        delete: 0,
        insert: 1,
    }
}

#[test]
fn a_pending_chain_staged_then_prepared_equals_its_items_appended_and_replayed() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, p2) = chain(&w, doc, ("xxq", ins(2)), ("xxqr", ins(3)));
    let mut req = rreq(&w, doc, "xxqr", &a);
    req.observed_parent = Some(ObservedRef::Pending { observation: p2 });
    let p = prepared(run(&w, doc, req, None).expect("prepare"));
    assert_eq!(p.postimage_hash, BlobHash::of_text("yxqr"));
    let (_twin, t) = assert_differential(dir.path(), w, doc, 1);
    assert_eq!(head_text(&t, doc), "xxqr");
    assert_eq!(state(&t, doc, &a).0, HunkState::Pending);
    let RevertDecision::Apply { postimage, .. } = t.plan_revert(doc, &a).expect("plan").decision
    else {
        panic!("the twin plans an applied revert");
    };
    assert_eq!(
        BlobHash::of_text(&postimage),
        p.postimage_hash,
        "the same postimage"
    );
}

#[test]
fn a_pending_chain_staged_then_decided_equals_its_items_appended_and_replayed() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let over_a = Edit {
        at: 0,
        delete: 1,
        insert: 1,
    };
    let (a, p2) = chain(&w, doc, ("xxq", ins(2)), ("zxq", over_a));
    let mut req = rreq(&w, doc, "zxq", &a);
    req.observed_parent = Some(ObservedRef::Pending { observation: p2 });
    let d = decided(run(&w, doc, req, None).expect("revert"));
    assert_eq!(d.action, ReviewAction::Conflicted);
    let (_twin, t) = assert_differential(dir.path(), w, doc, 1);
    assert_eq!(head_text(&t, doc), "zxq");
    assert_eq!(state(&t, doc, &a), (HunkState::Conflicted, d.review_gen));
}

#[test]
fn a_buffer_built_on_an_older_revision_is_refused_and_replays_to_the_same_projection() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let older = w.head(doc);
    human_save(&w, doc, "xxs");
    // The window still shows "xx" plus its own unsaved tail: its buffer
    // names the revision before the head's save, so the staged baseline is
    // a concurrent observation that blocks every span.
    let mut req = rreq(&w, doc, "xxt", &a);
    req.observed_parent = Some(observed_on(older));
    let before = mark(&w);
    let e = run(&w, doc, req, None).expect_err("a parent mismatch");
    assert!(
        matches!(
            e,
            TxnError::AmbiguousRevert { block: Some(ref b), .. }
                if b.reason == BreakReason::ParentMismatch
        ),
        "{e:?}"
    );
    assert_eq!(mark(&w), before, "the staged baseline was dropped");
    let (_twin, t) = assert_differential(dir.path(), w, doc, 0);
    assert_eq!(head_text(&t, doc), "xxs");
}

#[test]
fn a_stale_parent_is_refused_and_replays_to_the_same_projection() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    pending(&w, doc, observed_on(w.head(doc)), "xx", "xxq", &[ins(2)]);
    let mut req = rreq(&w, doc, "xxq", &a);
    req.parent = None;
    let before = mark(&w);
    let e = run(&w, doc, req, None).expect_err("stale parent");
    assert_eq!(e.code(), "STALE_PARENT");
    assert_eq!(mark(&w), before, "nothing appended");
    assert_eq!(
        w.lock().proj.docs[&doc].pending.len(),
        1,
        "the chain is not linearized"
    );
    // The pending capture then linearizes on the plain path.
    linearize(&w, doc);
    assert_differential(dir.path(), w, doc, 0);
}
