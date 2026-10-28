// WI-AL3.1b — comment receipts: an identical create or reply retry returns the stored reply and appends nothing; another payload under the same request id is a conflict; a receipt whose fields do not bind to its own record (comment, reply, revision, text hash, generation, commentGen, kind, carrier) is corrupt; abandoning an answered create or reply reports answered; and the frozen comment receipt fixtures, with generations past 2^53, round-trip byte for byte and survive the codec on their carriers
//! R107 rules 3 and 4, R64 §3–§4, through the comment handles and the
//! journal codec.

use serde_json::{json, Value};

use crate::agent_journal::admission::payload::Frame;
use crate::agent_journal::admission::receipt::{Outcome, PayloadDigest, Receipt};
use crate::agent_journal::admission::request_support::state;
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::comment::comment_support::*;
use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ReplyId};
use crate::agent_journal::comment::records::{CommentCreated, CommentReplied};
use crate::agent_journal::comment::wire::{CreateRequest, ReplyRequest};
use crate::agent_journal::comment_anchor::create_anchor;
use crate::agent_journal::ids::{BlobHash, TxnId};
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V5};
use crate::agent_journal::wire::decode_json;

#[test]
fn an_identical_create_or_reply_retry_returns_the_stored_reply_and_appends_nothing() {
    let (r, page) = rig();
    let p = r.frame(&page, create_body(&r, TEXT, SEL, "once"));
    let first = create_as(&r, &page, CommentCaller::User, &p).expect("create");
    let len = r.journal_len();
    assert_eq!(
        create_as(&r, &page, CommentCaller::User, &p).expect("retry"),
        first
    );
    assert_eq!(r.journal_len(), len, "an identical retry appends nothing");
    let c = comment_of(&first);
    let p = r.frame(&page, reply_body(c, 0, "once"));
    let first = reply_as(&r, &page, CommentCaller::User, &p).expect("reply");
    let len = r.journal_len();
    assert_eq!(
        reply_as(&r, &page, CommentCaller::User, &p).expect("retry"),
        first
    );
    assert_eq!(r.journal_len(), len);
    assert_eq!(
        thread(&r, c).comment_gen,
        1,
        "the retry did not reply twice"
    );
}

#[test]
fn another_payload_under_the_same_request_id_is_a_conflict() {
    let (r, page) = rig();
    let id = uuid::Uuid::new_v4().to_string();
    let mut b = create_body(&r, TEXT, SEL, "first");
    b["requestId"] = json!(id);
    let c = comment_of(
        &create_as(&r, &page, CommentCaller::User, &r.frame(&page, b.clone())).expect("create"),
    );
    let len = r.journal_len();
    b["body"] = json!("second");
    let e = create_as(&r, &page, CommentCaller::User, &r.frame(&page, b)).unwrap_err();
    assert_eq!(state(&e), "conflict");
    let mut rb = reply_body(c, 0, "first");
    rb["requestId"] = json!(uuid::Uuid::new_v4().to_string());
    reply_as(&r, &page, CommentCaller::User, &r.frame(&page, rb.clone())).expect("reply");
    let len2 = r.journal_len();
    assert!(len2 > len);
    rb["body"] = json!("second");
    let e = reply_as(&r, &page, CommentCaller::User, &r.frame(&page, rb)).unwrap_err();
    assert_eq!(state(&e), "conflict");
    assert_eq!(r.journal_len(), len2);
}

fn corrupt(v: &Value, what: &str) {
    match codec::decode(&serde_json::to_vec(v).unwrap()) {
        Err(e) => assert_eq!(e.code(), "JOURNAL_CORRUPT", "{what}: {e}"),
        Ok(d) => panic!("{what}: decoded {d:?}"),
    }
}

#[test]
fn a_receipt_that_does_not_bind_to_its_record_is_corrupt() {
    let (r, _) = carrier_journal();
    let records = v5_records(&r);
    let (admission, created, replied, state_rec) =
        (&records[0], &records[1], &records[2], &records[3]);
    for v in [admission, created, replied, state_rec] {
        let ok = codec::decode(&serde_json::to_vec(v).unwrap());
        assert!(
            matches!(ok, Ok(Decoded::Known(_))),
            "the real carrier decodes"
        );
    }
    let other = |v: &Value, path: &[&str], to: Value, what: &str| {
        let mut v = v.clone();
        let mut at = &mut v["receipt"]["outcome"]["response"];
        for k in &path[..path.len() - 1] {
            at = &mut at[*k];
        }
        at[path[path.len() - 1]] = to;
        corrupt(&v, what);
    };
    other(created, &["comment"], json!("c1"), "another comment");
    other(
        created,
        &["revision"],
        json!(TxnId::new().0),
        "another revision",
    );
    other(
        created,
        &["textHash"],
        json!(BlobHash::of_text("x")),
        "another text",
    );
    other(created, &["doc"], json!(TxnId::new().0), "another document");
    other(
        created,
        &["generation"],
        json!("1"),
        "a generation that is not the seq",
    );
    other(
        created,
        &["commentGen"],
        json!("1"),
        "a created commentGen that is not 0",
    );
    other(replied, &["reply"], json!("r1"), "another reply id");
    other(
        replied,
        &["commentGen"],
        replied["record"]["expectedCommentGen"].clone(),
        "a commentGen not bumped",
    );
    other(
        replied,
        &["generation"],
        json!("1"),
        "a reply generation that is not the seq",
    );
    // A receipt kind on another record, or on a record that takes none.
    let mut v = replied.clone();
    v["receipt"] = created["receipt"].clone();
    corrupt(&v, "a create receipt on a reply");
    let mut v = state_rec.clone();
    v["receipt"] = created["receipt"].clone();
    corrupt(&v, "a receipt on a state change");
    // A comment create is only an admission's last item.
    let mut v = admission.clone();
    v["record"]["items"].as_array_mut().unwrap().reverse();
    corrupt(&v, "a commentCreated before the frame's last item");
}

#[test]
fn abandoning_an_answered_create_or_reply_reports_answered() {
    let (r, page) = rig();
    let p = r.frame(&page, create_body(&r, TEXT, SEL, "answered"));
    let c = comment_of(&create_as(&r, &page, CommentCaller::User, &p).expect("create"));
    let len = r.journal_len();
    let out = r.abandon(&page.label, &p).expect("abandon");
    assert_eq!(out, json!({"state": "answered", "kind": "commentCreated"}));
    assert_eq!(r.journal_len(), len, "abandoning appends nothing");
    let p = r.frame(&page, reply_body(c, 0, "answered"));
    reply_as(&r, &page, CommentCaller::User, &p).expect("reply");
    let len = r.journal_len();
    let out = r.abandon(&page.label, &p).expect("abandon");
    assert_eq!(out, json!({"state": "answered", "kind": "commentReplied"}));
    assert_eq!(r.journal_len(), len, "abandoning appends nothing");
    assert_eq!(thread(&r, c).comment_gen, 1);
}

const FIXTURE: &str = include_str!("fixtures/comment_receipts.json");

fn case(name: &str) -> (String, String) {
    let f: Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
    let c = f["receipts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("fixture {name}"))
        .clone();
    let s = |k: &str| c[k].as_str().unwrap().to_owned();
    (s("payload"), s("receipt"))
}

/// `wire` decoded, re-encoded byte for byte, and digesting `payload`.
fn round_trip(payload: &str, wire: &str) -> Receipt {
    let r: Receipt = serde_json::from_str(wire).expect("decodes");
    assert_eq!(serde_json::to_string(&r).unwrap(), wire, "byte for byte");
    assert_eq!(
        r.digest,
        PayloadDigest::of(payload),
        "digest of the raw payload"
    );
    r
}

fn envelope(seq: u64, record: Record, receipt: Receipt) -> Vec<u8> {
    codec::encode(&Envelope {
        schema_version: SCHEMA_V5,
        seq,
        txn: TxnId::new(),
        at: 0,
        record,
        receipt: Some(receipt),
    })
}

#[test]
fn the_comment_created_fixture_round_trips_past_2_53_and_binds_on_its_carrier() {
    let (payload, wire) = case("commentCreated");
    let receipt = round_trip(&payload, &wire);
    let Outcome::CommentCreated(reply) = &receipt.outcome else {
        panic!("a create reply: {receipt:?}")
    };
    assert!(reply.generation > 1 << 53, "a generation past 2^53");
    let frame = Frame::decode(&payload).expect("framed");
    let req: CreateRequest = decode_json(frame.body().as_bytes()).expect("the payload decodes");
    assert_eq!(req.request_id, receipt.request_id);
    let anchor = create_anchor(&req.text, &req.selection, reply.revision)
        .expect("anchor")
        .anchor;
    let record = |seq: u64| {
        Record::CommentCreated(CommentCreated {
            doc: reply.doc,
            comment: CommentId::at(seq),
            revision: reply.revision,
            text_hash: BlobHash::of_text(&req.text),
            anchor: anchor.clone(),
            body: req.body.clone(),
            author: req.author.clone(),
            caller: CommentCaller::User,
        })
    };
    let seq = reply.generation;
    assert_eq!(reply.text_hash, BlobHash::of_text(&req.text));
    let ok = codec::decode(&envelope(seq, record(seq), receipt.clone()));
    assert!(matches!(ok, Ok(Decoded::Known(_))), "{ok:?}");
    let off = codec::decode(&envelope(seq - 1, record(seq - 1), receipt));
    assert_eq!(off.unwrap_err().code(), "JOURNAL_CORRUPT");
}

#[test]
fn the_comment_replied_fixture_round_trips_past_2_53_and_binds_on_its_carrier() {
    let (payload, wire) = case("commentReplied");
    let receipt = round_trip(&payload, &wire);
    let Outcome::CommentReplied(reply) = &receipt.outcome else {
        panic!("a reply reply: {receipt:?}")
    };
    assert!(reply.generation > 1 << 53 && reply.comment_gen > 1 << 53);
    let frame = Frame::decode(&payload).expect("framed");
    let req: ReplyRequest = decode_json(frame.body().as_bytes()).expect("the payload decodes");
    assert_eq!(req.request_id, receipt.request_id);
    let record = |expected: u64| {
        Record::CommentReplied(CommentReplied {
            doc: reply.doc,
            comment: req.comment,
            reply: ReplyId::at(reply.generation),
            body: req.body.clone(),
            author: req.author.clone(),
            caller: CommentCaller::Agent,
            expected_comment_gen: expected,
        })
    };
    let seq = reply.generation;
    let ok = codec::decode(&envelope(
        seq,
        record(req.expected_comment_gen),
        receipt.clone(),
    ));
    assert!(matches!(ok, Ok(Decoded::Known(_))), "{ok:?}");
    let off = codec::decode(&envelope(
        seq,
        record(req.expected_comment_gen + 1),
        receipt,
    ));
    assert_eq!(off.unwrap_err().code(), "JOURNAL_CORRUPT");
}
