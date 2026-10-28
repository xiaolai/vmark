//! The `seq` order replay holds a journal to. Every record's `seq` is
//! unique and increasing, so no two records share a generation. A
//! compacted journal opens with a `journalHeader` whose `seq` is its floor;
//! its retained records keep their own (lower) seqs, in order, and records
//! appended since count past the floor, so the one rule covers both. An
//! `admission` frame shares its first item's `seq` and its items are
//! contiguous (`admission::shape`), so the items are what is ordered.
//!
//! @module agent_journal/replay_seq

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::record::{Envelope, Record};

#[derive(Debug, Default)]
pub(super) struct SeqOrder {
    last: Option<u64>,
    floor: Option<u64>,
}

impl SeqOrder {
    /// Refuse `env` unless its records extend the order seen so far.
    pub fn check(&mut self, env: &Envelope) -> Result<(), TxnError> {
        match &env.record {
            Record::JournalHeader { generation_floor } if self.floor.is_none() => {
                if env.seq != *generation_floor {
                    return Err(corrupt(env.seq, "a journalHeader not at its floor"));
                }
                self.floor = Some(env.seq);
                Ok(())
            }
            Record::Admission { items } => items.iter().try_for_each(|item| self.next(item.seq)),
            _ => self.next(env.seq),
        }
    }

    fn next(&mut self, seq: u64) -> Result<(), TxnError> {
        if self.last.is_some_and(|last| seq <= last) {
            return Err(corrupt(seq, "does not follow the record before it"));
        }
        if self.floor == Some(seq) {
            return Err(corrupt(seq, "is the journalHeader's floor"));
        }
        self.last = Some(seq);
        Ok(())
    }
}

fn corrupt(seq: u64, why: &str) -> TxnError {
    TxnError::Corrupt(format!("seq {seq} {why}"))
}
