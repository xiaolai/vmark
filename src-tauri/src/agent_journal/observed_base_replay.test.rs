//! A save replayed ahead of its pending base's evidence. Compaction drops a
//! collected observation's `pendingObservation` and keeps its revision as a
//! tombstone at the linearization, which can come after a retained save
//! built on that observation. Below the compaction floor the save waits for
//! the tombstone; the tombstone must then carry the document and text the
//! save observed, and a replay that ends still waiting is corrupt. Above
//! the floor (a live append) an unknown base is refused at once.

use crate::agent_journal::actor::Actor;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::{Envelope, ObservedRef, Record, SCHEMA_VERSION};
use crate::agent_journal::review::ReviewOp;

const FLOOR: u64 = 10;

fn env(seq: u64, txn: TxnId, record: Record) -> Envelope {
    Envelope {
        schema_version: SCHEMA_VERSION,
        seq,
        txn,
        at: 1,
        record,
        receipt: None,
    }
}

/// A compacted journal's start: the header at the floor.
fn compacted() -> Projection {
    let mut p = Projection::default();
    p.apply(&env(
        FLOOR,
        TxnId(uuid::Uuid::nil()),
        Record::JournalHeader {
            generation_floor: FLOOR,
        },
    ))
    .expect("header");
    p
}

/// A save on `doc` built on the dropped observation `base`, seeing `pre`.
fn save_on(doc: DocId, base: TxnId, pre: &str) -> Record {
    Record::PendingObservation {
        doc,
        actor: Actor::Human,
        initiator: Actor::Human,
        postimage: BlobHash::of_text("ab"),
        observed_parent: ObservedRef::Pending { observation: base },
        observed_preimage: BlobHash::of_text(pre),
        provenance: None,
    }
}

/// The tombstone compaction leaves for an observation on `doc`.
fn tombstone(doc: DocId, post: &str) -> Record {
    Record::Tombstone {
        doc,
        revision: RevisionId::new(),
        parent: None,
        actor: Actor::Human,
        preimage: None,
        postimage: BlobHash::of_text(post),
        review_op: ReviewOp::None,
        hunks: vec![],
        transitions: vec![],
        attached_to: None,
        addresses: vec![],
    }
}

fn corrupt<T: std::fmt::Debug>(r: Result<T, TxnError>) {
    assert!(matches!(r, Err(TxnError::Corrupt(_))), "{r:?}");
}

#[test]
fn a_save_below_the_floor_waits_for_its_base_tombstone_and_then_replays_whole() {
    let (doc, base) = (DocId::new(), TxnId::new());
    let mut p = compacted();
    p.apply(&env(2, TxnId::new(), save_on(doc, base, "a")))
        .expect("waits for the tombstone");
    corrupt(p.finish_replay());
    p.apply(&env(3, base, tombstone(doc, "a")))
        .expect("the tombstone settles it");
    p.finish_replay().expect("whole");
}

#[test]
fn a_waiting_save_is_refused_by_a_tombstone_of_other_text_or_document() {
    let (doc, base) = (DocId::new(), TxnId::new());
    let mut p = compacted();
    p.apply(&env(2, TxnId::new(), save_on(doc, base, "a")))
        .expect("waits");
    for record in [tombstone(doc, "z"), tombstone(DocId::new(), "a")] {
        let before = p.clone();
        corrupt(p.clone().apply(&env(3, base, record)));
        assert_eq!(p, before);
    }
}

#[test]
fn a_waiting_save_whose_base_is_recorded_later_is_refused() {
    let (doc, base) = (DocId::new(), TxnId::new());
    let mut p = compacted();
    p.apply(&env(2, TxnId::new(), save_on(doc, base, "")))
        .expect("waits");
    let later = Record::PendingObservation {
        doc,
        actor: Actor::Human,
        initiator: Actor::Human,
        postimage: BlobHash::of_text(""),
        observed_parent: ObservedRef::Genesis,
        observed_preimage: BlobHash::of_text(""),
        provenance: None,
    };
    corrupt(p.apply(&env(3, base, later)));
}

#[test]
fn an_unknown_base_above_the_floor_is_refused_at_once() {
    let (doc, base) = (DocId::new(), TxnId::new());
    let mut p = compacted();
    let before = p.clone();
    corrupt(p.apply(&env(FLOOR + 1, TxnId::new(), save_on(doc, base, "a"))));
    assert_eq!(p, before, "nothing waits");
}

/// Startup replay holds the journal to the same end check: a compacted
/// journal whose save still waits when the file ends does not open.
#[test]
fn a_journal_ending_with_a_waiting_save_does_not_open() {
    use crate::agent_journal::codec;
    use crate::agent_journal::faults::Faults;
    use crate::agent_journal::journal_file::{JournalFile, SyncPolicy, JOURNAL_FILE};
    use crate::agent_journal::test_support::{config, tmp};
    use crate::agent_journal::writer::Writer;
    let dir = tmp();
    {
        let mut f = JournalFile::open(
            &dir.path().join(JOURNAL_FILE),
            SyncPolicy::None,
            std::sync::Arc::new(Faults::default()),
        )
        .expect("journal")
        .file;
        let header = Record::JournalHeader {
            generation_floor: FLOOR,
        };
        f.append(&codec::encode(&env(
            FLOOR,
            TxnId(uuid::Uuid::nil()),
            header,
        )))
        .expect("header");
        let save = save_on(DocId::new(), TxnId::new(), "a");
        f.append(&codec::encode(&env(2, TxnId::new(), save)))
            .expect("save");
    }
    let opened = Writer::open(config(dir.path(), SyncPolicy::None).0);
    corrupt(opened.map(|_| ()));
}
