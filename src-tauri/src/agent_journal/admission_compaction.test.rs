// WI-AL2.2a — compaction rewrites an admission frame as its children, top-level and unchanged: a surviving item keeps its seq and its receipt, a collected revision's items are tombstoned or dropped as top-level records are, a collected transaction takes its receipt with it, and every rewrite reopens to the projection the collector expected; a frame torn at any byte applies none of its items
//! R50 rule 4, R57 and R103's carrier clauses.

use std::collections::BTreeSet;

use crate::agent_journal::admission::admission_support::*;
use crate::agent_journal::admission::receipt::Receipt;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::{Envelope, Record};
use crate::agent_journal::test_support::{config, human_save, observe, tmp};
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::{GcPolicy, GcReport};

/// Collect down to `max_revisions` live revisions per document.
fn compact(w: &Writer, max_revisions: usize) -> GcReport {
    w.collect(&GcPolicy {
        max_revisions,
        ..GcPolicy::default()
    })
    .expect("collect")
}

fn reopen(dir: &std::path::Path) -> Projection {
    let (w, _) = Writer::open(config(dir, SyncPolicy::Full).0).expect("reopen");
    let p = w.lock().proj.clone();
    p
}

/// The top-level `prepared` record carrying a receipt, as written.
fn receipted(w: &Writer) -> Vec<(u64, Receipt)> {
    w.debug_records()
        .into_iter()
        .flat_map(|e| match e.record {
            Record::Admission { items } => items,
            _ => vec![e],
        })
        .filter_map(|e: Envelope| e.receipt.map(|r| (e.seq, r)))
        .collect()
}

fn commit(c: &Controller, txn: &str, text: &str) {
    c.commit(txn, &serde_json::json!({ "postimage": text }).to_string())
        .expect("commit");
}

#[test]
fn compaction_keeps_surviving_seq_and_receipts_and_reopens_clean() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "seed\n");
    // {observation, linearization B, prepared T}
    let t = c
        .prepare(&body(Some(head), "seed\nunsaved\n", Some(&request_id())).to_string())
        .expect("prepare");
    let b = t.baseline.expect("baseline B");
    commit(&c, &t.txn.to_string(), "seed\nunsaved\nagent\n");
    close_epoch(&c.writer, d);
    let receipts = receipted(&c.writer);
    assert_eq!(receipts.len(), 1);

    let report = compact(&c.writer, 1);
    assert!(report.collected.contains(&b), "B collected: {report:?}");
    assert!(!report.collected.contains(&t.revision));
    let records = c.writer.debug_records();
    assert!(
        records
            .iter()
            .all(|e| !matches!(e.record, Record::Admission { .. })),
        "the frame is expanded"
    );
    assert_eq!(
        receipted(&c.writer),
        receipts,
        "T's seq and receipt unchanged"
    );
    let live_proj = c.writer.lock().proj.clone();
    assert_eq!(live_proj.requests.len(), 1);
    drop(c);
    assert_eq!(reopen(dir.path()), live_proj, "reopen clean");
}

#[test]
fn collecting_the_receipted_transaction_removes_its_receipt_from_replay_and_expected() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "seed\n");
    let t = c
        .prepare(&body(Some(head), "seed\n", Some(&request_id())).to_string())
        .expect("direct prepare");
    commit(&c, &t.txn.to_string(), "seed\nagent\n");
    human_save(&c.writer, d, "seed\nagent\nmore\n");
    human_save(&c.writer, d, "seed\nagent\nmore\nmost\n");
    close_epoch(&c.writer, d);

    let report = compact(&c.writer, 1);
    assert!(report.collected.contains(&t.revision), "{report:?}");
    assert!(
        c.writer.lock().proj.requests.is_empty(),
        "gone from expected()"
    );
    assert!(receipted(&c.writer).is_empty());
    let live_proj = c.writer.lock().proj.clone();
    drop(c);
    let replayed = reopen(dir.path());
    assert!(replayed.requests.is_empty(), "gone from replay");
    assert_eq!(replayed, live_proj);
}

#[test]
fn compaction_expands_a_frame_that_linearizes_several_observations() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "0\n");
    observe(&c.writer, d, "0\n1\n", None);
    observe(&c.writer, d, "0\n1\n2\n", None);
    let t = c
        .prepare(&body(Some(head), "0\n1\n2\n3\n", Some(&request_id())).to_string())
        .expect("prepare");
    let frame = c.writer.debug_records().pop().unwrap();
    let Record::Admission { items } = &frame.record else {
        panic!("{frame:?}")
    };
    assert_eq!(
        items.len(),
        5,
        "two linearizations, a baseline pair, the prepared"
    );
    commit(&c, &t.txn.to_string(), "0\n1\n2\n3\n4\n");
    close_epoch(&c.writer, d);
    let receipts = receipted(&c.writer);

    let report = compact(&c.writer, 2);
    assert!(!report.collected.is_empty(), "{report:?}");
    assert_eq!(receipted(&c.writer), receipts);
    let live_proj = c.writer.lock().proj.clone();
    drop(c);
    assert_eq!(reopen(dir.path()), live_proj);
}

#[test]
fn an_admission_torn_at_any_byte_applies_none_of_its_items() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "a\n");
    close_epoch(&c.writer, d);
    let start = c.writer.journal_len();
    c.prepare(&body(Some(head), "a\nb\n", Some(&request_id())).to_string())
        .expect("prepare");
    let end = c.writer.journal_len();
    drop(c);
    let whole = std::fs::read(dir.path().join(JOURNAL_FILE)).unwrap();
    let path = dir.path().join(JOURNAL_FILE);

    std::fs::write(&path, &whole[..usize::try_from(start).unwrap()]).unwrap();
    let before = reopen(dir.path());
    let mut seen = BTreeSet::new();
    for cut in start..end {
        std::fs::write(&path, &whole[..usize::try_from(cut).unwrap()]).unwrap();
        let p = reopen(dir.path());
        assert_eq!(p, before, "torn at byte {cut}");
        seen.insert(p.generation);
    }
    assert_eq!(seen.len(), 1);
}
