// WI-AL2.2a — the frozen receipt fixtures (`fixtures/receipts.json`, shared with the TypeScript client): the agent write's and the restore's `prepared` receipts decode through the production types and re-encode byte for byte, each digest is SHA-256 over its exact payload, and two payloads differing only in field order digest differently | AL2.2b: the schema-4 revert receipts (an applied revert's `prepared` with its patch, a revert's recorded decision) round-trip byte for byte, their payloads decode as revert requests, and each survives the journal codec at v4 on its carrier (a `hunkRevert` prepared; a review decision top level and inside an admission) and is corrupt labelled v3
//! R64 §3–§4, R101 rule 2, R103 rule 7 and R106 rules 4–6.

use serde_json::Value;

use crate::agent_journal::admission::admission_shape_tests::{env, observation, prepared};
use crate::agent_journal::admission::receipt::{Outcome, PayloadDigest, PreparedResponse, Receipt};
use crate::agent_journal::controlled_restore::decode_restore_prepare;
use crate::agent_journal::controlled_revert::{
    decode_revert_prepare, RevertDecided, RevertPrepared,
};
use crate::agent_journal::controlled_wire::decode_prepare;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V3, SCHEMA_V4};
use crate::agent_journal::review::{ReviewItem, ReviewOp};

const FIXTURE: &str = include_str!("fixtures/receipts.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("fixture is JSON")
}

fn case(name: &str) -> (String, String) {
    let f = fixture();
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

#[test]
fn the_controlled_prepared_receipt_round_trips_byte_for_byte() {
    let (payload, wire) = case("controlledPrepared");
    let r: Receipt = serde_json::from_str(&wire).expect("decodes");
    let Outcome::Prepared(PreparedResponse::Controlled(p)) = &r.outcome else {
        panic!("a controlled reply: {r:?}")
    };
    assert_eq!(p.generation, u64::MAX - 1, "a u64 past 2^53 survives");
    assert!(p.baseline.is_some());
    assert_eq!(serde_json::to_string(&r).unwrap(), wire, "byte for byte");
    assert_eq!(
        r.digest,
        PayloadDigest::of(&payload),
        "digest of the raw payload"
    );
    let req = decode_prepare(payload.as_bytes()).expect("the payload decodes");
    assert_eq!(req.request_id, Some(r.request_id));
}

#[test]
fn the_restore_prepared_receipt_round_trips_byte_for_byte() {
    let (payload, wire) = case("restorePrepared");
    let r: Receipt = serde_json::from_str(&wire).expect("decodes");
    let Outcome::Prepared(PreparedResponse::Restore(p)) = &r.outcome else {
        panic!("a restore reply: {r:?}")
    };
    assert!(p.resolves.is_some(), "non-null resolves");
    assert!(p.text.contains("café") && p.text.contains('🧾') && p.text.contains('\u{0}'));
    assert_eq!(serde_json::to_string(&r).unwrap(), wire, "byte for byte");
    assert_eq!(r.digest, PayloadDigest::of(&payload));
    let req = decode_restore_prepare(payload.as_bytes()).expect("the payload decodes");
    assert_eq!(req.request_id, Some(r.request_id));
}

#[test]
fn a_receipt_survives_the_journal_codec_on_its_prepared() {
    use crate::agent_journal::codec::{decode, encode, Decoded};
    for name in ["controlledPrepared", "restorePrepared"] {
        let (_, wire) = case(name);
        let receipt: Receipt = serde_json::from_str(&wire).unwrap();
        let (doc, revision, generation) = match &receipt.outcome {
            Outcome::Prepared(PreparedResponse::Controlled(p)) => (p.doc, p.revision, p.generation),
            Outcome::Prepared(PreparedResponse::Restore(p)) => (p.doc, p.revision, p.generation),
            other => panic!("{name}: a v3 reply, not {other:?}"),
        };
        let env = Envelope {
            schema_version: 3,
            seq: generation,
            txn: receipt
                .txn()
                .expect("a prepared reply names its transaction"),
            at: 0,
            record: prepared(doc, None, revision, "pre"),
            receipt: Some(receipt.clone()),
        };
        let Decoded::Known(back) = decode(&encode(&env)).expect("decodes") else {
            panic!("{name}: a known record")
        };
        assert_eq!(back.receipt, Some(receipt), "{name}");
    }
}

#[test]
fn payloads_differing_only_in_field_order_digest_differently() {
    let f = fixture();
    let orders = f["fieldOrder"].as_array().unwrap();
    assert_eq!(orders.len(), 2);
    let digests: Vec<PayloadDigest> = orders
        .iter()
        .map(|o| {
            let p = o["payload"].as_str().unwrap();
            let d = PayloadDigest::of(p);
            assert_eq!(
                serde_json::to_value(&d).unwrap(),
                o["digest"],
                "stored digest"
            );
            d
        })
        .collect();
    assert_ne!(
        digests[0], digests[1],
        "hashed as bytes, never re-canonicalized"
    );
    let decoded: Vec<_> = orders
        .iter()
        .map(|o| decode_prepare(o["payload"].as_str().unwrap().as_bytes()).unwrap())
        .collect();
    assert_eq!(decoded[0], decoded[1], "the same request either way");
}

#[test]
fn the_revert_receipts_round_trip_byte_for_byte() {
    for name in ["revertPrepared", "revertDecided"] {
        let (payload, wire) = case(name);
        let r: Receipt = serde_json::from_str(&wire).expect("decodes");
        match (&r.outcome, name) {
            (Outcome::Prepared(PreparedResponse::Revert(p)), "revertPrepared") => {
                assert_eq!(p.generation, (1 << 53) + 1, "a u64 past 2^53 survives");
                assert!(p.insert.contains('🧾') && p.insert.contains("原文"));
            }
            (Outcome::Decision(d), "revertDecided") => assert_eq!(d.review_gen, 4),
            (other, _) => panic!("{name}: {other:?}"),
        }
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            wire,
            "{name}: byte for byte"
        );
        assert_eq!(r.digest, PayloadDigest::of(&payload), "{name}: digest");
        let req = decode_revert_prepare(payload.as_bytes()).expect("a revert request");
        assert_eq!(req.request_id, Some(r.request_id), "{name}");
    }
}

fn revert_receipt(name: &str) -> Receipt {
    serde_json::from_str(&case(name).1).expect("decodes")
}

/// The `hunkRevert` prepared that `p` answers, at its own generation.
fn revert_carrier(r: Receipt, p: &RevertPrepared) -> Envelope {
    let Record::Prepared {
        doc,
        parent,
        revision,
        preimage,
        actor,
        initiator,
        tool,
        certificate,
        ..
    } = prepared(p.doc, None, p.revision, "pre")
    else {
        unreachable!()
    };
    let record = Record::Prepared {
        doc,
        parent,
        revision,
        preimage,
        actor,
        initiator,
        tool,
        certificate,
        review_op: ReviewOp::HunkRevert {
            hunk_id: p.hunk.clone(),
            expected_review_gen: p.review_gen,
        },
    };
    Envelope {
        schema_version: SCHEMA_V4,
        receipt: Some(r),
        ..env(p.generation, p.txn, record)
    }
}

/// The review decision `d` answers, at its own seq.
fn decision_carrier(r: Receipt, d: &RevertDecided) -> Envelope {
    let record = Record::ReviewDecision {
        doc: d.doc,
        expected_head: d.head,
        action: d.action,
        items: vec![ReviewItem {
            hunk_id: d.hunk.clone(),
            expected_review_gen: d.review_gen - 1,
        }],
    };
    Envelope {
        schema_version: SCHEMA_V4,
        receipt: Some(r),
        ..env(d.generation, TxnId::new(), record)
    }
}

#[track_caller]
fn assert_round_trips_at_v4_and_corrupt_at_v3(env: Envelope, what: &str) {
    use crate::agent_journal::codec::{decode, encode, Decoded};
    let Decoded::Known(back) = decode(&encode(&env)).expect(what) else {
        panic!("{what}: a known record")
    };
    assert_eq!(*back, env, "{what}");
    let mut v: Value = serde_json::to_value(&env).unwrap();
    v["schemaVersion"] = SCHEMA_V3.into();
    if let Some(items) = v["record"]["items"].as_array_mut() {
        for item in items {
            item["schemaVersion"] = SCHEMA_V3.into();
        }
    }
    let e = decode(&serde_json::to_vec(&v).unwrap()).expect_err(what);
    assert_eq!(e.code(), "JOURNAL_CORRUPT", "{what} labelled v3: {e}");
}

#[test]
fn the_revert_receipts_survive_the_codec_on_their_carriers_only_at_v4() {
    let r = revert_receipt("revertPrepared");
    let Outcome::Prepared(PreparedResponse::Revert(p)) = r.outcome.clone() else {
        unreachable!()
    };
    assert_round_trips_at_v4_and_corrupt_at_v3(revert_carrier(r, &p), "a revert's prepared");

    let r = revert_receipt("revertDecided");
    let Outcome::Decision(d) = r.outcome.clone() else {
        unreachable!()
    };
    let top = decision_carrier(r, &d);
    assert_round_trips_at_v4_and_corrupt_at_v3(top.clone(), "a top-level decision");

    let first = Envelope {
        schema_version: SCHEMA_V4,
        ..env(d.generation - 1, TxnId::new(), observation(d.doc, "x"))
    };
    let frame = Envelope {
        schema_version: SCHEMA_V4,
        txn: top.txn,
        ..env(
            first.seq,
            top.txn,
            Record::Admission {
                items: vec![first, top],
            },
        )
    };
    assert_round_trips_at_v4_and_corrupt_at_v3(frame, "a decision inside an admission");
}
