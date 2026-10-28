// WI-AL2.2b — a revert's receipt: an identical retry of an applied revert or of a recorded decision gets the same reply with nothing appended, another payload under the id is a conflict, the decision's receipt survives a reopen and a collection, abandoning a decided request answers decided; a receipted revert is schema 4, which a schema-3 reader refuses as FUTURE_FORMAT untouched and which relabelled schema 3 is corrupt; and every field binding a revert reply to its record is checked
//! R106 rules 5–9.

use std::path::Path;

use serde_json::{json, Value};
use sha2_v011::{Digest, Sha256};

use super::revert_support::*;
use crate::agent_journal::admission::answer::RequestState;
use crate::agent_journal::admission::receipt::PayloadDigest;
use crate::agent_journal::admission::request_support::rig;
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::{Envelope, SCHEMA_V3, SCHEMA_V4};
use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

/// A receipted conflicted revert, recorded as a top-level decision.
fn decided_doc(
    w: &Writer,
    doc: DocId,
) -> (
    crate::agent_journal::controlled_revert::RevertPrepareRequest,
    PayloadDigest,
) {
    let (a, _) = conflicted_pending(w, doc);
    receipted(rreq(w, doc, "zx", &a))
}

fn raw_records(dir: &Path) -> Vec<Value> {
    let bytes = std::fs::read(dir.join(JOURNAL_FILE)).expect("journal");
    crate::agent_journal::frame::scan(&bytes)
        .expect("frames")
        .frames
        .iter()
        .map(|f| serde_json::from_slice(&f.payload).expect("json"))
        .collect()
}

fn last_receipted(dir: &Path) -> Value {
    raw_records(dir)
        .into_iter()
        .rev()
        .find(|v| v["receipt"].is_object())
        .expect("a receipted record")
}

fn decode(v: &Value) -> Result<Envelope, TxnError> {
    match codec::decode(&serde_json::to_vec(v).unwrap())? {
        Decoded::Known(env) => Ok(*env),
        Decoded::Future { version, .. } => panic!("decoded as future v{version}"),
    }
}

/// Replay every record of `dir` with the last receipted one replaced.
fn replay_with(dir: &Path, last: Value) -> Result<(), TxnError> {
    let mut records = raw_records(dir);
    let at = records
        .iter()
        .rposition(|v| v["receipt"].is_object())
        .expect("receipted");
    records[at] = last;
    let mut p = Projection::default();
    for v in &records {
        p.apply(&decode(v)?)?;
    }
    Ok(())
}

#[test]
fn an_identical_retry_of_an_applied_revert_gets_the_same_reply() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let (req, digest) = receipted(rreq(&w, doc, "xx", &a));
    let first = run(&w, doc, req.clone(), Some(digest.clone())).expect("prepare");
    let before = mark(&w);
    assert_eq!(run(&w, doc, req, Some(digest)).expect("retry"), first);
    assert_eq!(mark(&w), before);
    assert_eq!(
        last_receipted(dir.path())["schemaVersion"],
        json!(SCHEMA_V4)
    );
}

#[test]
fn an_identical_retry_of_a_decision_gets_the_same_reply_and_another_payload_conflicts() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (req, digest) = decided_doc(&w, doc);
    let first = decided(run(&w, doc, req.clone(), Some(digest.clone())).expect("revert"));
    let before = mark(&w);
    assert_eq!(
        decided(run(&w, doc, req.clone(), Some(digest)).expect("retry")),
        first
    );
    assert_eq!(mark(&w), before, "a retry appends nothing");
    let e = run(&w, doc, req, Some(PayloadDigest::of("another payload"))).expect_err("conflict");
    assert!(
        matches!(e, TxnError::Request(ref r) if r.state == RequestState::Conflict),
        "{e:?}"
    );
}

#[test]
fn a_decision_receipt_survives_a_reopen_and_a_collection() {
    let dir = tmp();
    let doc = DocId::new();
    let (req, digest, first) = {
        let (w, _) = open(dir.path());
        let (req, digest) = decided_doc(&w, doc);
        let first = run(&w, doc, req.clone(), Some(digest.clone())).expect("revert");
        (req, digest, first)
    };
    let (w, _) = open(dir.path());
    assert_eq!(
        run(&w, doc, req.clone(), Some(digest.clone())).expect("after reopen"),
        first
    );
    for text in ["p", "pq", "pqr"] {
        human_save(&w, doc, text);
    }
    let report = w
        .collect(&GcPolicy {
            max_revisions: 1,
            ..GcPolicy::default()
        })
        .expect("collect");
    assert!(!report.collected.is_empty(), "{report:?}");
    assert_eq!(
        run(&w, doc, req, Some(digest)).expect("after collection"),
        first
    );
}

#[test]
fn abandoning_a_decided_request_answers_decided() {
    let r = rig();
    let page = r.page("doc-a", 1);
    let w = &*r.c.writer;
    let doc = crate::agent_journal::admission::admission_support::doc(&r.c);
    let (a, _) = conflicted_pending(w, doc);
    let mut req = rreq(w, doc, "zx", &a);
    let id = uuid::Uuid::new_v4().to_string();
    let payload = r.frame(&page, json!({ "requestId": id, "hunkId": a }));
    req.request_id = Some(id.parse().expect("id"));
    decided(run(w, doc, req, Some(PayloadDigest::of(&payload))).expect("revert"));
    assert_eq!(
        r.abandon(&page.label, &payload).expect("abandon"),
        json!({ "state": "decided" })
    );
}

fn hashes(dir: &Path) -> Vec<u8> {
    Sha256::digest(std::fs::read(dir.join(JOURNAL_FILE)).expect("journal")).to_vec()
}

#[test]
fn a_schema_3_reader_refuses_a_revert_receipt_untouched() {
    for applied in [true, false] {
        let dir = tmp();
        let doc = DocId::new();
        {
            let (w, _) = open(dir.path());
            let (req, digest) = if applied {
                let (a, _) = two_hunks(&w, doc);
                receipted(rreq(&w, doc, "xx", &a))
            } else {
                decided_doc(&w, doc)
            };
            run(&w, doc, req, Some(digest)).expect("revert");
        }
        let before = hashes(dir.path());
        let e = Writer::open_with_max_schema(config(dir.path(), SyncPolicy::Full).0, SCHEMA_V3)
            .err()
            .expect("off");
        assert_eq!(e.code(), "JOURNAL_FUTURE_FORMAT", "{e}");
        assert_eq!(hashes(dir.path()), before);
        open(dir.path());
    }
}

#[test]
fn a_revert_receipt_labelled_schema_3_is_corrupt() {
    for applied in [true, false] {
        let dir = tmp();
        let doc = DocId::new();
        let (w, _) = open(dir.path());
        let (req, digest) = if applied {
            let (a, _) = two_hunks(&w, doc);
            receipted(rreq(&w, doc, "xx", &a))
        } else {
            decided_doc(&w, doc)
        };
        run(&w, doc, req, Some(digest)).expect("revert");
        let mut v = last_receipted(dir.path());
        decode(&v).expect("the v4 record decodes");
        v["schemaVersion"] = json!(SCHEMA_V3);
        assert_eq!(
            decode(&v).expect_err("relabelled").code(),
            "JOURNAL_CORRUPT"
        );
    }
}

#[test]
fn a_decision_receipt_naming_another_record_is_corrupt() {
    let dir = tmp();
    let doc = DocId::new();
    let (w, _) = open(dir.path());
    let (req, digest) = decided_doc(&w, doc);
    run(&w, doc, req, Some(digest)).expect("revert");
    let good = last_receipted(dir.path());
    replay_with(dir.path(), good.clone()).expect("the stored record replays");
    let mutations: [(&str, Value); 4] = [
        ("head", json!(crate::agent_journal::ids::RevisionId::new())),
        ("generation", json!("9999")),
        ("action", json!("revertFoundBase")),
        ("hunk", json!("h-another")),
    ];
    for (field, value) in mutations {
        let mut v = good.clone();
        v["receipt"]["outcome"]["response"][field] = value;
        let e = replay_with(dir.path(), v).expect_err(field);
        assert_eq!(e.code(), "JOURNAL_CORRUPT", "{field}: {e}");
    }
    let mut v = good;
    let next = v["receipt"]["outcome"]["response"]["reviewGen"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap()
        + 1;
    v["receipt"]["outcome"]["response"]["reviewGen"] = json!(next.to_string());
    let e = replay_with(dir.path(), v).expect_err("reviewGen");
    assert_eq!(e.code(), "JOURNAL_CORRUPT", "reviewGen: {e}");
}

#[test]
fn a_revert_prepared_receipt_naming_another_review_gen_or_kind_is_corrupt() {
    let dir = tmp();
    let doc = DocId::new();
    let (w, _) = open(dir.path());
    let (a, _) = two_hunks(&w, doc);
    let rg = state(&w, doc, &a).1;
    let (req, digest) = receipted(rreq(&w, doc, "xx", &a));
    run(&w, doc, req, Some(digest)).expect("prepare");
    let good = last_receipted(dir.path());
    let response = good["receipt"]["outcome"]["response"].clone();
    let mut wrong_gen = good.clone();
    wrong_gen["receipt"]["outcome"]["response"]["reviewGen"] = json!((rg + 1).to_string());
    let mut controlled = good.clone();
    controlled["receipt"]["outcome"]["response"] = json!({
        "doc": response["doc"], "txn": response["txn"], "revision": response["revision"],
        "generation": response["generation"], "baseline": null, "certified": false, "fallbackReason": null,
    });
    for (case, v) in [("reviewGen", wrong_gen), ("controlled", controlled)] {
        let e = replay_with(dir.path(), v).expect_err(case);
        assert_eq!(e.code(), "JOURNAL_CORRUPT", "{case}: {e}");
    }
}
