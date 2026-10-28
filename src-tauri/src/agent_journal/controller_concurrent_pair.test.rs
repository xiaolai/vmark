// WI-AL2.4 — "edited in two windows" shows both pairs: for a concurrent revision only, `agent_journal_concurrent_pair` returns the observed before-text (what the saving window started from), the linear before-text (the parent's postimage) and the postimage; retention collecting both older revisions keeps all three; a text the pack lost is JOURNAL_CORRUPT, never a silent gap; any other revision, an unknown one, another document's, or a malformed payload is refused as invalid input; the read appends nothing and mints no document
use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use crate::agent_journal::controller::Controller;
use crate::agent_journal::degraded_drain::{Backoff, DrainScheduler};
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::projection::RevisionKind;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::{ObserveRequest, Writer};
use crate::agent_journal::writer_gc::GcPolicy;
use crate::command_error::{CommandError, ErrorCode};

const KEY: &str = "path:/two-windows.md";
/// What both windows loaded.
const LOADED: &str = "Hi 你好";
/// What the agent committed while the other window was editing.
const AGENT: &str = "Hi 你好!";
/// What the other window saved, from `LOADED`.
const SAVED: &str = "Hi 你好🎉";

fn controller() -> (tempfile::TempDir, Controller, Arc<Writer>, Arc<DocRegistry>) {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let w = Arc::new(w);
    let docs: Arc<DocRegistry> = Arc::default();
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(w.clone(), docs.clone(), Arc::new(drains));
    (dir, c, w, docs)
}

struct Revs {
    loaded: RevisionId,
    agent: RevisionId,
    concurrent: RevisionId,
}

/// A human save of `SAVED` observed on `LOADED` that lands after the agent's
/// commit of `AGENT`: a concurrent observation whose linear parent is the
/// agent's revision.
fn two_windows(w: &Writer, doc: DocId) -> Revs {
    let loaded = human_save(w, doc, LOADED);
    let p = w
        .prepare(prepare_req(doc, Some(loaded), LOADED, ReviewOp::Review))
        .expect("prepare");
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: SAVED.into(),
        observed_parent: ObservedRef::Revision { revision: loaded },
        provenance: None,
    })
    .expect("observe");
    let edit = Edit {
        at: 5,
        delete: 0,
        insert: 1,
    };
    let agent = w
        .commit(p.txn, commit_req(w, doc, AGENT, edit, vec![]))
        .expect("commit")
        .revision;
    let concurrent = linearize(w, doc).revision;
    let s = w.snapshot().state;
    assert_eq!(s.revisions[&concurrent].kind, RevisionKind::Concurrent);
    assert_eq!(s.revisions[&concurrent].parent, Some(agent));
    Revs {
        loaded,
        agent,
        concurrent,
    }
}

fn pair(c: &Controller, key: &str, revision: &str) -> Result<serde_json::Value, CommandError> {
    c.concurrent_pair(&serde_json::json!({ "docKey": key, "revision": revision }).to_string())
        .map(|p| serde_json::to_value(p).expect("serializes"))
}

fn journal_code(e: &CommandError) -> String {
    e.detail().expect("detail")["journalCode"]
        .as_str()
        .expect("journalCode")
        .to_owned()
}

fn assert_invalid(r: Result<serde_json::Value, CommandError>, why: &str) {
    let e = r.expect_err(why);
    assert_eq!(e.code(), ErrorCode::InvalidInput, "{why}: {e:?}");
    assert_eq!(journal_code(&e), "INVALID_REQUEST", "{why}");
}

#[test]
fn a_concurrent_revision_returns_both_before_texts_and_its_result() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let r = two_windows(&w, doc);
    let out = pair(&c, KEY, &r.concurrent.to_string()).expect("pair");
    assert_eq!(
        out,
        serde_json::json!({
            "observedBefore": LOADED,
            "linearBefore": AGENT,
            "result": SAVED,
        }),
        "observed preimage → postimage, and the parent's postimage → postimage"
    );
}

#[test]
fn any_other_revision_is_refused_as_invalid_input() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let r = two_windows(&w, doc);
    assert_invalid(pair(&c, KEY, &r.loaded.to_string()), "an observed save");
    assert_invalid(pair(&c, KEY, &r.agent.to_string()), "a controlled write");
    assert_invalid(
        pair(&c, KEY, &RevisionId::new().to_string()),
        "an unknown revision",
    );
    // The same revision named under another document's key.
    let other = "path:/other.md";
    human_save(&w, docs.resolve(other).unwrap(), "x");
    assert_invalid(
        pair(&c, other, &r.concurrent.to_string()),
        "another document's revision",
    );
}

#[test]
fn a_malformed_payload_or_unknown_key_is_refused_and_mints_nothing() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let r = two_windows(&w, doc);
    let rev = r.concurrent.to_string();
    let before = w.journal_len();
    for bad in [
        "not json".to_owned(),
        serde_json::json!({ "docKey": KEY }).to_string(),
        serde_json::json!({ "docKey": KEY, "revision": "not-a-uuid" }).to_string(),
        serde_json::json!({ "docKey": KEY, "revision": rev, "extra": 1 }).to_string(),
    ] {
        let e = c.concurrent_pair(&bad).expect_err(&bad);
        assert_eq!(e.code(), ErrorCode::InvalidInput, "{bad}");
    }
    assert_invalid(pair(&c, "path:/never.md", &rev), "a key never seen");
    assert!(
        docs.find("path:/never.md").unwrap().is_none(),
        "a read never makes a document"
    );
    pair(&c, KEY, &rev).expect("a good read");
    assert_eq!(w.journal_len(), before, "a read appends nothing");
}

#[test]
fn retention_keeps_all_three_texts_while_the_concurrent_revision_lives() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let r = two_windows(&w, doc);
    let report = w
        .collect(&GcPolicy {
            max_revisions: 1,
            ..GcPolicy::default()
        })
        .expect("collect");
    assert_eq!(
        report.collected,
        vec![r.loaded, r.agent],
        "the two older revisions are collected, the concurrent one kept"
    );
    let out = pair(&c, KEY, &r.concurrent.to_string()).expect("pair");
    assert_eq!(out["observedBefore"], LOADED, "{out}");
    assert_eq!(out["linearBefore"], AGENT, "{out}");
    assert_eq!(out["result"], SAVED, "{out}");
}

#[test]
fn a_text_the_pack_lost_is_corruption_not_a_gap() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let r = two_windows(&w, doc);
    for lost in [LOADED, AGENT, SAVED] {
        let keep: BTreeSet<BlobHash> = [LOADED, AGENT, SAVED]
            .into_iter()
            .filter(|t| *t != lost)
            .map(BlobHash::of_text)
            .collect();
        w.lock().blobs.compact(&keep).expect("compact");
        let e = pair(&c, KEY, &r.concurrent.to_string()).expect_err(lost);
        assert_eq!(e.code(), ErrorCode::Internal, "{lost}");
        assert_eq!(journal_code(&e), "JOURNAL_CORRUPT", "{lost}");
        // Put every text back for the next round.
        let mut g = w.lock();
        for t in [LOADED, AGENT, SAVED] {
            g.blobs.put(&BlobHash::of_text(t), t).expect("restore blob");
        }
    }
}
