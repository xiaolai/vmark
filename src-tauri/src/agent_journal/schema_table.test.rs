// WI-AL2.0s — the per-version table: a kind labelled below its version is corrupt, the writer labels each record with its minimum (never below v2), and a v3 label on a v2 kind decodes, and a prepared record's selection certificate is a v3 field (WI-AL2.1c)
//! The per-version record table (R35).
//!
//! Edge cases: a v1 label on a v2 kind (refused by `check` directly, since
//! `codec_v1` would refuse it earlier in a real decode); a label above the
//! kind's minimum (accepted); a label one past the reader's maximum
//! (`Future`, never `Corrupt`).

use super::{check, label, min_schema};
use crate::agent_journal::actor::Actor;
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::ids::{BlobHash, RevisionId};
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::provenance::{Provenance, ProvenancePayload, PROVENANCE_CAP};
use crate::agent_journal::record::{
    Envelope, Record, MAX_SUPPORTED_SCHEMA, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3,
};
use crate::agent_journal::review::ReviewOp;

fn env(version: u32, record: Record) -> Envelope {
    Envelope {
        schema_version: version,
        seq: 1,
        txn: TxnId::new(),
        at: 0,
        record,
        receipt: None,
    }
}

fn armed() -> Record {
    Record::EpochArmed {
        doc: DocId::new(),
        epoch: 1,
    }
}

#[test]
fn a_v2_kind_labelled_v1_is_corrupt() {
    let err = check(&env(SCHEMA_V1, armed())).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_CORRUPT", "{err}");
}

#[test]
fn a_kind_at_or_above_its_minimum_passes() {
    for v in [SCHEMA_V2, MAX_SUPPORTED_SCHEMA] {
        check(&env(v, armed())).unwrap();
        check(&env(v, Record::Uncommitted)).unwrap();
    }
    check(&env(SCHEMA_V1, Record::Uncommitted)).unwrap();
}

#[test]
fn the_writer_labels_every_current_kind_v2() {
    assert_eq!(min_schema(&Record::Uncommitted), SCHEMA_V1);
    assert_eq!(label(&Record::Uncommitted), SCHEMA_V2);
    assert_eq!(min_schema(&armed()), SCHEMA_V2);
    assert_eq!(label(&armed()), SCHEMA_V2);
}

#[test]
fn a_v3_label_on_a_v2_kind_decodes_and_one_past_the_maximum_is_future() {
    let at_max = codec::encode(&env(MAX_SUPPORTED_SCHEMA, armed()));
    assert!(matches!(codec::decode(&at_max).unwrap(), Decoded::Known(_)));
    let past = codec::encode(&env(MAX_SUPPORTED_SCHEMA + 1, armed()));
    assert!(matches!(
        codec::decode(&past).unwrap(),
        Decoded::Future { version, .. } if version == MAX_SUPPORTED_SCHEMA + 1
    ));
}

/// A `prepared` record, with or without a selection edit's certificate.
fn prepared(certificate: Option<ProvenancePayload>) -> Record {
    Record::Prepared {
        doc: DocId::new(),
        parent: None,
        revision: RevisionId::new(),
        preimage: BlobHash::of_text("a"),
        actor: Actor::Human,
        initiator: Actor::Human,
        tool: "selection.set".into(),
        review_op: ReviewOp::Review,
        certificate,
    }
}

#[test]
fn a_prepared_certificate_is_a_v3_field() {
    let map = Provenance::new(1, PROVENANCE_CAP).unwrap();
    let cert = ProvenancePayload::encode("d", "0", "genesis", "a", "a", &map).unwrap();
    assert_eq!(min_schema(&prepared(None)), SCHEMA_V1);
    assert_eq!(label(&prepared(None)), SCHEMA_V2, "no certificate stays v2");
    assert_eq!(min_schema(&prepared(Some(cert.clone()))), SCHEMA_V3);
    assert_eq!(label(&prepared(Some(cert.clone()))), SCHEMA_V3);
    let err = check(&env(SCHEMA_V2, prepared(Some(cert)))).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_CORRUPT", "{err}");
}

/// A tombstone, labelled v2, with no addresses.
fn tombstone() -> Record {
    Record::Tombstone {
        doc: DocId::new(),
        revision: RevisionId::new(),
        parent: None,
        actor: Actor::Human,
        preimage: None,
        postimage: BlobHash::of_text("a"),
        review_op: ReviewOp::Review,
        hunks: vec![],
        transitions: vec![],
        attached_to: None,
        addresses: vec![],
    }
}

/// `record` labelled v2 and encoded, with `key` set to `value` at `at`
/// (`""`: the envelope, `"record"`: the record).
fn with_explicit(record: Record, at: &str, key: &str, value: serde_json::Value) -> Vec<u8> {
    let mut json: serde_json::Value =
        serde_json::from_slice(&codec::encode(&env(SCHEMA_V2, record))).unwrap();
    let target = if at.is_empty() {
        &mut json
    } else {
        &mut json[at]
    };
    target.as_object_mut().unwrap().insert(key.into(), value);
    serde_json::to_vec(&json).unwrap()
}

#[test]
fn a_versioned_field_present_but_empty_under_an_older_label_is_corrupt() {
    // serde reads `null` and `[]` as absent, so presence is checked in the raw record.
    let cases = [
        with_explicit(
            prepared(None),
            "record",
            "certificate",
            serde_json::Value::Null,
        ),
        with_explicit(tombstone(), "record", "addresses", serde_json::json!([])),
        with_explicit(prepared(None), "", "receipt", serde_json::Value::Null),
    ];
    for bytes in cases {
        let err = codec::decode(&bytes).unwrap_err();
        assert_eq!(
            err.code(),
            "JOURNAL_CORRUPT",
            "{err}: {}",
            String::from_utf8_lossy(&bytes)
        );
    }
    for clean in [prepared(None), tombstone()] {
        let bytes = codec::encode(&env(SCHEMA_V2, clean));
        assert!(matches!(codec::decode(&bytes), Ok(Decoded::Known(_))));
    }
}
