// The replayed `seq` order: unique and increasing, the compaction header's floor excepted
//! Replay refuses a journal whose sequence numbers repeat or go back: two
//! records at one `seq` would collide as generations. A compacted journal
//! opens with a `journalHeader` at its floor, then its retained records
//! (below the floor, still increasing) and then records past it.
//!
//! Edge cases: a repeated `seq`; a `seq` going back; a retained record
//! going back after the header; a record at the header's own floor; a
//! well-formed compacted journal.

use super::Replay;
use crate::agent_journal::codec;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::frame::FrameSink;
use crate::agent_journal::gc_compact::header;
use crate::agent_journal::ids::{BlobHash, TxnId};
use crate::agent_journal::record::{
    Envelope, LegacyAnchor, Record, MAX_SUPPORTED_SCHEMA, SCHEMA_V2,
};

/// A legacy checkpoint at `seq`, its id unique to the seq.
fn legacy(seq: u64) -> Envelope {
    Envelope {
        schema_version: SCHEMA_V2,
        seq,
        txn: TxnId::new(),
        at: 0,
        record: Record::LegacyCheckpoint {
            legacy_id: format!("l{seq}-{}", TxnId::new().0),
            preimage: BlobHash::of_text("a"),
            postimage: None,
            anchor: LegacyAnchor::Tab { tab_id: "t".into() },
            tool: "write".into(),
            description: String::new(),
            timestamp: 0,
        },
        receipt: None,
    }
}

/// Replay `envs` in order: the first refusal's message, if any.
fn replayed(envs: &[Envelope]) -> Result<(), String> {
    let mut replay = Replay::new(MAX_SUPPORTED_SCHEMA, &Faults::default());
    for env in envs {
        let payload = codec::encode(env);
        replay.chunk(&payload)?;
        replay.frame(0, payload.len() as u64)?;
    }
    Ok(())
}

#[test]
fn increasing_seqs_replay() {
    replayed(&[legacy(1), legacy(2), legacy(9)]).expect("increasing");
}

#[test]
fn a_repeated_seq_is_corrupt() {
    let e = replayed(&[legacy(1), legacy(5), legacy(5)]).unwrap_err();
    assert!(e.contains("seq 5"), "{e}");
}

#[test]
fn a_seq_going_back_is_corrupt() {
    let e = replayed(&[legacy(6), legacy(5)]).unwrap_err();
    assert!(e.contains("seq 5"), "{e}");
}

#[test]
fn a_compacted_journal_retains_records_below_its_floor() {
    replayed(&[header(10), legacy(3), legacy(7), legacy(11)]).expect("compacted");
}

#[test]
fn a_retained_record_going_back_is_corrupt() {
    let e = replayed(&[header(10), legacy(7), legacy(3)]).unwrap_err();
    assert!(e.contains("seq 3"), "{e}");
}

#[test]
fn a_record_at_the_header_floor_is_corrupt() {
    let e = replayed(&[header(10), legacy(3), legacy(10)]).unwrap_err();
    assert!(e.contains("seq 10"), "{e}");
}
