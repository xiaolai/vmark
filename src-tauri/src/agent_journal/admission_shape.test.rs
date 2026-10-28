// WI-AL2.2a — an `admission` frame and a receipt are validated at decode like any top-level record: child envelopes go through the one decoder, the frame shape (two or more items, contiguous seq, one `at`, one document, no nesting, allowed kinds, one receipt on the last item) and the receipt's binding to its `prepared` record are checked before anything reduces
//! Decode-time refusals of admissions and receipts (R50 rule 1, R56, R103).
//!
//! Every case starts from one valid admission — a pending observation, its
//! linearization and a receipted `prepared` — serialized by production
//! serde, then breaks exactly one thing in the JSON. Each must be
//! `JOURNAL_CORRUPT`, never `FUTURE_FORMAT` and never a silent drop.

use serde_json::{json, Value};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::receipt::{Outcome, PreparedResponse, Receipt};
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::controlled_restore::RestorePrepared;
use crate::agent_journal::controlled_revert::RevertPrepared;
use crate::agent_journal::controlled_wire::ControlledPrepared;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::record::{Envelope, ObservedRef, Record, SCHEMA_V2, SCHEMA_V3};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::agent;

pub(crate) const REQUEST: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
pub(crate) const DIGEST: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

pub(crate) fn env(seq: u64, txn: TxnId, record: Record) -> Envelope {
    Envelope {
        schema_version: SCHEMA_V3,
        seq,
        txn,
        at: 1_700_000_000_000,
        record,
        receipt: None,
    }
}

pub(crate) fn observation(doc: DocId, text: &str) -> Record {
    Record::PendingObservation {
        doc,
        actor: Actor::Human,
        initiator: Actor::Human,
        postimage: BlobHash::of_text(text),
        observed_parent: ObservedRef::Genesis,
        observed_preimage: BlobHash::of_text(""),
        provenance: None,
    }
}

pub(crate) fn linearized(revision: RevisionId) -> Record {
    Record::ObservedRevision {
        revision,
        parent: None,
        effects: Default::default(),
    }
}

pub(crate) fn prepared(
    doc: DocId,
    parent: Option<RevisionId>,
    revision: RevisionId,
    pre: &str,
) -> Record {
    Record::Prepared {
        doc,
        parent,
        revision,
        preimage: BlobHash::of_text(pre),
        actor: agent(),
        initiator: agent(),
        tool: "document.write".into(),
        review_op: ReviewOp::Review,
        certificate: None,
    }
}

pub(crate) fn receipt(doc: DocId, txn: TxnId, revision: RevisionId, generation: u64) -> Receipt {
    Receipt {
        request_id: REQUEST.parse().expect("a v4 request id"),
        digest: DIGEST.parse().expect("a sha-256 digest"),
        outcome: Outcome::Prepared(PreparedResponse::Controlled(ControlledPrepared {
            doc,
            txn,
            revision,
            generation,
            baseline: None,
            certified: false,
            fallback_reason: None,
        })),
    }
}

/// `{observation O, linearization of O, prepared T + receipt}` at seq 10.
pub(crate) fn valid_admission() -> (Envelope, DocId) {
    let doc = DocId::new();
    let (o, t) = (TxnId::new(), TxnId::new());
    let (b, rev) = (RevisionId::new(), RevisionId::new());
    let mut last = env(12, t, prepared(doc, Some(b), rev, "x"));
    last.receipt = Some(receipt(doc, t, rev, 12));
    let items = vec![
        env(10, o, observation(doc, "x")),
        env(11, o, linearized(b)),
        last,
    ];
    (env(10, t, Record::Admission { items }), doc)
}

fn to_value(e: &Envelope) -> Value {
    serde_json::to_value(e).unwrap()
}

#[track_caller]
fn assert_corrupt(v: &Value, why: &str) {
    match codec::decode(&serde_json::to_vec(v).unwrap()) {
        Err(e) => assert_eq!(e.code(), "JOURNAL_CORRUPT", "{why}: {e}"),
        Ok(d) => panic!("{why}: decoded {d:?}"),
    }
}

fn items(v: &mut Value) -> &mut Vec<Value> {
    v["record"]["items"].as_array_mut().unwrap()
}

#[test]
fn a_valid_admission_decodes_and_reencodes_byte_for_byte() {
    let (a, _) = valid_admission();
    let bytes = codec::encode(&a);
    match codec::decode(&bytes).expect("decodes") {
        Decoded::Known(e) => {
            assert_eq!(*e, a);
            assert_eq!(codec::encode(&e), bytes);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_child_envelope_is_refused_like_a_top_level_record() {
    let (a, _) = valid_admission();
    let base = to_value(&a);

    let mut v2_receipt = base.clone();
    items(&mut v2_receipt)[2]["schemaVersion"] = json!(SCHEMA_V2);
    assert_corrupt(&v2_receipt, "an inner v2 envelope carrying a receipt");

    for version in [1, 2, 4] {
        let mut v = base.clone();
        items(&mut v)[0]["schemaVersion"] = json!(version);
        assert_corrupt(&v, &format!("an inner schema {version}"));
    }

    let mut extra = base.clone();
    items(&mut extra)[1] = json!({"schemaVersion": 3, "seq": "11", "txn": TxnId::new(),
        "at": 1_700_000_000_000u64, "record": {"kind": "uncommitted", "note": "x"}});
    assert_corrupt(&extra, "an inner uncommitted with an extra field");

    let mut committed = base.clone();
    items(&mut committed)[1]["record"] = json!({"kind": "committed",
        "postimage": BlobHash::of_text("x"), "effects": {}});
    assert_corrupt(&committed, "an inner v3 committed with no provenance");

    let mut unknown = base.clone();
    items(&mut unknown)[1]["record"]["extra"] = json!(1);
    assert_corrupt(&unknown, "an inner record with an unknown field");
}

#[test]
fn a_prepared_receipt_must_name_its_own_txn_revision_document_and_generation() {
    let (a, _) = valid_admission();
    for (field, value) in [
        ("txn", json!(TxnId::new())),
        ("revision", json!(RevisionId::new())),
        ("doc", json!(DocId::new())),
        ("generation", json!("13")),
    ] {
        let mut child = to_value(&a);
        items(&mut child)[2]["receipt"]["outcome"]["response"][field] = value.clone();
        assert_corrupt(
            &child,
            &format!("an admission child receipt with another {field}"),
        );

        let Record::Admission { items: inner } = &a.record else {
            unreachable!()
        };
        let mut top = to_value(&inner[2]);
        top["receipt"]["outcome"]["response"][field] = value;
        assert_corrupt(&top, &format!("a top-level receipt with another {field}"));
    }
}

/// A `prepared` at seq 12 on `parent`, receipted with `response`, its
/// record carrying `review_op`; with `doc`, its document.
fn receipted(
    review_op: ReviewOp,
    parent: Option<RevisionId>,
    response: impl FnOnce(DocId, TxnId, RevisionId) -> PreparedResponse,
) -> (Envelope, DocId) {
    let (doc, t, rev) = (DocId::new(), TxnId::new(), RevisionId::new());
    let mut e = env(12, t, prepared(doc, parent, rev, "x"));
    if let Record::Prepared { review_op: op, .. } = &mut e.record {
        *op = review_op;
    }
    let mut r = receipt(doc, t, rev, 12);
    r.outcome = Outcome::Prepared(response(doc, t, rev));
    e.schema_version = crate::agent_journal::schema_table::receipt_min(&r);
    e.receipt = Some(r);
    (e, doc)
}

/// `last` carried as the outcome of an admission that first observes and
/// linearizes its document onto `base`, all at `last`'s schema.
fn carried(last: Envelope, doc: DocId, base: RevisionId) -> Envelope {
    let o = TxnId::new();
    let schema = last.schema_version;
    let mut items = vec![
        env(10, o, observation(doc, "x")),
        env(11, o, linearized(base)),
    ];
    for item in &mut items {
        item.schema_version = schema;
    }
    let mut a = env(10, last.txn, Record::Admission { items: vec![] });
    a.schema_version = schema;
    items.push(last);
    a.record = Record::Admission { items };
    a
}

#[test]
fn a_restore_or_revert_receipt_must_name_its_own_txn_revision_document_and_generation() {
    for base in [None, Some(RevisionId::new())] {
        restore_and_revert_receipts_bind(base);
    }
}

/// Top-level when `base` is `None`; otherwise carried by an admission
/// linearized onto `base`.
fn restore_and_revert_receipts_bind(base: Option<RevisionId>) {
    let hunk = HunkId("h-1".into());
    let restore = receipted(ReviewOp::Review, base, |doc, txn, revision| {
        PreparedResponse::Restore(RestorePrepared {
            doc,
            txn,
            revision,
            generation: 12,
            baseline: None,
            text: "x".into(),
            resolves: None,
        })
    });
    let op = ReviewOp::HunkRevert {
        hunk_id: hunk.clone(),
        expected_review_gen: 3,
    };
    let revert = receipted(op, base, |doc, txn, revision| {
        PreparedResponse::Revert(RevertPrepared {
            doc,
            txn,
            revision,
            generation: 12,
            baseline: None,
            hunk,
            review_gen: 3,
            from: 0,
            to: 1,
            insert: String::new(),
            postimage_hash: BlobHash::of_text(""),
        })
    });
    for (kind, (e, doc)) in [("restore", restore), ("revert", revert)] {
        let e = match base {
            Some(b) => carried(e, doc, b),
            None => e,
        };
        let bytes = codec::encode(&e);
        let control = codec::decode(&bytes);
        assert!(
            matches!(control, Ok(Decoded::Known(_))),
            "{kind} ({base:?}): the control decodes: {control:?}"
        );
        for (field, value) in [
            ("txn", json!(TxnId::new())),
            ("revision", json!(RevisionId::new())),
            ("doc", json!(DocId::new())),
            ("generation", json!("13")),
        ] {
            let mut v = to_value(&e);
            let receipt = match base {
                Some(_) => &mut items(&mut v)[2]["receipt"],
                None => &mut v["receipt"],
            };
            receipt["outcome"]["response"][field] = value;
            assert_corrupt(
                &v,
                &format!("a {kind} receipt ({base:?}) with another {field}"),
            );
        }
    }
}

#[test]
fn the_admission_frame_shape_is_enforced() {
    let (a, _) = valid_admission();
    let base = to_value(&a);

    let mut gap = base.clone();
    items(&mut gap)[2]["seq"] = json!("13");
    assert_corrupt(&gap, "a gap in seq");

    let mut start = base.clone();
    start["seq"] = json!("9");
    assert_corrupt(&start, "items not starting at the outer seq");

    let mut at = base.clone();
    items(&mut at)[1]["at"] = json!(1_700_000_000_001u64);
    assert_corrupt(&at, "a second `at`");

    let mut two_docs = base.clone();
    items(&mut two_docs)[0]["record"]["doc"] = json!(DocId::new());
    assert_corrupt(&two_docs, "two documents");

    let mut two_receipts = base.clone();
    let r = items(&mut two_receipts)[2]["receipt"].clone();
    items(&mut two_receipts)[0]["receipt"] = r.clone();
    assert_corrupt(&two_receipts, "two receipts");

    let mut not_last = base.clone();
    items(&mut not_last)[2]
        .as_object_mut()
        .unwrap()
        .remove("receipt");
    items(&mut not_last)[0]["receipt"] = r.clone();
    assert_corrupt(&not_last, "a receipt not on the last item");

    let mut outer = base.clone();
    outer["receipt"] = r;
    assert_corrupt(&outer, "a receipt on the admission envelope itself");

    let mut nested = base.clone();
    let inner = base.clone();
    items(&mut nested)[0] = inner;
    assert_corrupt(&nested, "a nested admission");

    let mut one = base.clone();
    items(&mut one).drain(..2);
    one["seq"] = json!("12");
    assert_corrupt(&one, "a one-item admission");

    let mut v2 = base.clone();
    v2["schemaVersion"] = json!(SCHEMA_V2);
    assert_corrupt(&v2, "an admission labelled v2");

    let mut kind = base.clone();
    items(&mut kind)[1]["record"] =
        json!({"kind": "epochArmed", "doc": DocId::new(), "epoch": "1"});
    assert_corrupt(&kind, "an item kind admissions never carry");

    let mut txn = base.clone();
    txn["txn"] = json!(TxnId::new());
    assert_corrupt(&txn, "an outer txn that is not the outcome item's");
}

/// An admission of `records` at seq 10, its `txn` the last item's.
fn frame_of(records: Vec<(TxnId, Record)>) -> Value {
    let items: Vec<Envelope> = (10..)
        .zip(records)
        .map(|(seq, (txn, record))| env(seq, txn, record))
        .collect();
    let txn = items.last().expect("an item").txn;
    to_value(&env(10, txn, Record::Admission { items }))
}

#[test]
fn an_admission_ends_in_exactly_one_outcome() {
    let doc = DocId::new();
    let (o, t, u) = (TxnId::new(), TxnId::new(), TxnId::new());
    let (b, rev, rev2) = (RevisionId::new(), RevisionId::new(), RevisionId::new());
    let obs = || (o, observation(doc, "x"));
    let lin = || (o, linearized(b));
    let prep = |txn, r| (txn, prepared(doc, Some(b), r, "x"));

    assert_corrupt(&frame_of(vec![obs(), lin()]), "no outcome");
    assert_corrupt(
        &frame_of(vec![obs(), lin(), prep(t, rev), prep(u, rev2)]),
        "two outcomes",
    );
    assert_corrupt(
        &frame_of(vec![obs(), prep(t, rev), lin()]),
        "an outcome before a linearization",
    );
    let ok = frame_of(vec![obs(), lin(), prep(t, rev)]);
    assert!(
        codec::decode(&serde_json::to_vec(&ok).unwrap()).is_ok(),
        "observation, linearization, one outcome last"
    );
}

#[test]
fn a_receipt_is_legal_only_on_a_v3_prepared_envelope() {
    let (a, doc) = valid_admission();
    let Record::Admission { items: inner } = &a.record else {
        unreachable!()
    };
    let top = to_value(&inner[2]);
    assert!(
        codec::decode(&serde_json::to_vec(&top).unwrap()).is_ok(),
        "a top-level v3 prepared may carry its receipt"
    );

    let mut v2 = top.clone();
    v2["schemaVersion"] = json!(SCHEMA_V2);
    assert_corrupt(&v2, "a receipt on a v2 prepared");

    let mut obs = to_value(&env(5, TxnId::new(), observation(doc, "y")));
    obs["receipt"] = top["receipt"].clone();
    assert_corrupt(&obs, "a receipt on a pending observation");
}

#[test]
fn a_receipt_outside_this_schema_or_malformed_is_corrupt() {
    let (a, _) = valid_admission();
    let Record::Admission { items: inner } = &a.record else {
        unreachable!()
    };
    let top = to_value(&inner[2]);
    let cases: [(&str, &str, Value); 7] = [
        ("outcome", "kind", json!("decision")),
        ("outcome", "kind", json!("commentCreated")),
        ("", "requestId", json!(REQUEST.to_uppercase())),
        (
            "",
            "requestId",
            json!("0f8fad5b-d9cb-169f-a165-70867728950e"),
        ),
        ("", "requestId", json!(format!("{REQUEST}0"))),
        ("", "digest", json!(DIGEST.to_uppercase())),
        ("", "digest", json!(&DIGEST[1..])),
    ];
    for (outer, field, value) in cases {
        let mut v = top.clone();
        let target = if outer.is_empty() {
            &mut v["receipt"]
        } else {
            &mut v["receipt"][outer]
        };
        target[field] = value.clone();
        assert_corrupt(&v, &format!("receipt {field} = {value}"));
    }
    let mut extra = top.clone();
    extra["receipt"]["note"] = json!(1);
    assert_corrupt(&extra, "a receipt with an unknown field");
    let mut response = top;
    response["receipt"]["outcome"]["response"]["extra"] = json!(1);
    assert_corrupt(&response, "a response with an unknown field");
}
