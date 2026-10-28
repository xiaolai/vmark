// WI-AL2.2a — a multi-record prepare (pending linearizations, a baseline, the prepared) is one atomic admission frame and a single-record prepare is one top-level frame, each with its receipt: a write error refuses with journal, pack, projection, generation, reservations and events unchanged; an fsync failure answers indeterminate, poisons the writer and reopens to the whole frame or none of it; success swaps the staged projection, which equals the replayed one; a pending capture makes a prepare an admission even when its buffer equals the head
//! R44 rule 5's outcome table and R103 rules 1–3, through the controller.

use std::io::Write as _;
use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::agent_journal::admission::admission_support::*;
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::{Projection, TxnStatus};
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V3};
use crate::agent_journal::test_support::{config, human_save, observe, tmp};
use crate::agent_journal::writer::Writer;
use crate::agent_journal::{codec, frame};

fn reopen(dir: &std::path::Path) -> Writer {
    Writer::open(config(dir, SyncPolicy::Full).0)
        .expect("reopen")
        .0
}

fn commit(c: &crate::agent_journal::controller::Controller, txn: &str, text: &str) {
    let out = c
        .commit(txn, &json!({ "postimage": text }).to_string())
        .expect("commit");
    assert!(out.durable);
}

/// The next journal append fails as a write error the file truncates back.
fn fail_write(faults: &crate::agent_journal::faults::Faults) {
    faults.fail_next_appends(1);
}

#[test]
fn an_admission_write_error_refuses_with_journal_and_projection_unchanged() {
    let dir = tmp();
    let (c, faults) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "kept text\n");
    let before = observable(&c.writer, dir.path());
    let rx = c.writer.subscribe();

    fail_write(&faults);
    let req = request_id();
    let out = c.prepare(&body(Some(head), "kept text\nunsaved\n", Some(&req)).to_string());

    assert_eq!(outcome(&out), "refused", "{out:?}");
    let after = observable(&c.writer, dir.path());
    assert_eq!(after.proj, before.proj, "projection unchanged");
    assert_eq!(
        after.journal_len, before.journal_len,
        "journal len unchanged"
    );
    assert_eq!(after.generation, before.generation);
    assert_eq!(after.reservations, before.reservations);
    assert!(appended(&rx).is_empty(), "no append event");
    assert!(after.proj.requests.is_empty(), "no receipt published");

    // Nothing is fenced: the same request goes through once the disk does.
    let p = c
        .prepare(&body(Some(head), "kept text\nunsaved\n", Some(&req)).to_string())
        .expect("the retry prepares");
    assert!(p.baseline.is_some());
}

#[test]
fn an_admission_fsync_failure_is_indeterminate_and_reopens_cleanly() {
    for frame_survives in [true, false] {
        let dir = tmp();
        let (c, faults) = controller(dir.path());
        let d = doc(&c);
        let head = human_save(&c.writer, d, "base\n");
        close_epoch(&c.writer, d);
        let before = observable(&c.writer, dir.path());
        let rx = c.writer.subscribe();
        // What reached the disk: the writer truncates back after a failed
        // fsync, but the bytes may already be durable.
        let written: Arc<Mutex<Option<Vec<u8>>>> = Arc::default();
        let sink = written.clone();
        faults.set_append_hook(Some(Arc::new(move |env: &Envelope| {
            *sink.lock().unwrap() = Some(frame::encode(&codec::encode(env)));
        })));

        faults.fail_next_fsyncs(1);
        let out = c.prepare(&body(Some(head), "base\nunsaved\n", Some(&request_id())).to_string());
        faults.set_append_hook(None);

        let err = out.as_ref().expect_err("not prepared");
        assert!(
            err.detail().expect("detail")["indeterminate"] == json!(true),
            "indeterminate: {err:?}"
        );
        assert!(
            err.detail().expect("detail")["uncertain"] == json!(true),
            "an fsync failure is uncertain for the client: {err:?}"
        );
        assert_eq!(journal_code(err), "JOURNAL_IO");
        assert_eq!(outcome(&out), "indeterminate");
        let poisoned = c.writer.health().expect_err("poisoned writer");
        assert_eq!(poisoned.code(), "JOURNAL_DEGRADED", "Poisoned: {poisoned}");
        let after = observable(&c.writer, dir.path());
        assert_eq!(after.proj, before.proj, "the live projection is unchanged");
        assert_eq!(after.reservations, before.reservations);
        assert!(appended(&rx).is_empty());
        drop(c);

        if frame_survives {
            let bytes = written
                .lock()
                .unwrap()
                .take()
                .expect("the frame was written");
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(dir.path().join(JOURNAL_FILE))
                .unwrap();
            f.write_all(&bytes).unwrap();
        }
        let w = reopen(dir.path());
        let g = w.lock();
        let revs = |p: &Projection| p.revisions.values().filter(|m| m.doc == d).count();
        let baselines = revs(&g.proj) - revs(&before.proj);
        if frame_survives {
            assert_eq!(baselines, 1, "the whole frame: one baseline");
            let t = g
                .proj
                .txns
                .values()
                .find(|t| t.doc == d && t.tool == "document.write")
                .expect("the prepared item");
            assert_eq!(t.status, TxnStatus::Uncommitted, "recovered as uncommitted");
            assert_eq!(g.proj.requests.len(), 1, "its receipt replays");
        } else {
            assert_eq!(baselines, 0, "none of it");
            assert!(g.proj.requests.is_empty());
            assert_eq!(g.proj.generation, before.generation);
        }
    }
}

#[test]
fn an_admission_success_prepares_and_swaps_the_projection() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "one\n");
    observe(&c.writer, d, "one\ntwo\n", None); // pending: linearized in the frame
    let len = c.writer.journal_len();
    let rx = c.writer.subscribe();

    let p = c
        .prepare(&body(Some(head), "one\ntwo\nthree\n", Some(&request_id())).to_string())
        .expect("Prepared");
    let records = c.writer.debug_records();
    let last = records.last().expect("a record");
    let Record::Admission { items } = &last.record else {
        panic!("one admission frame: {last:?}")
    };
    assert_eq!(
        items.len(),
        4,
        "linearization, baseline observation and linearization, prepared"
    );
    assert_eq!(last.schema_version, SCHEMA_V3);
    assert!(c.writer.journal_len() > len);
    let seqs: Vec<u64> = items.iter().map(|e| e.seq).collect();
    assert_eq!(appended(&rx), seqs, "one event per item, in order");
    assert_eq!(p.generation, *seqs.last().unwrap());
    assert_ne!(c.writer.head(d), Some(head));

    commit(&c, &p.txn.to_string(), "one\ntwo\nthree\nfour\n");
    close_epoch(&c.writer, d);
    let live_proj = c.writer.lock().proj.clone();
    drop(c);
    let replayed_proj = reopen(dir.path()).lock().proj.clone();
    assert_eq!(
        live_proj, replayed_proj,
        "the swapped projection equals the replayed one"
    );
}

#[test]
fn an_uncertified_single_record_prepare_is_one_v3_frame_carrying_its_receipt() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let before = c.writer.debug_records().len();
    let req = request_id();
    let p = c
        .prepare(&body(None, "", Some(&req)).to_string())
        .expect("prepared");
    let records = c.writer.debug_records();
    assert_eq!(records.len(), before + 1, "exactly one frame");
    let env = records.last().unwrap();
    assert!(matches!(env.record, Record::Prepared { .. }), "{env:?}");
    assert_eq!(
        env.schema_version, SCHEMA_V3,
        "a receipt makes the frame v3"
    );
    let receipt = env
        .receipt
        .as_ref()
        .expect("the receipt rides in the frame");
    assert_eq!(receipt.request_id.to_string(), req);
    let stored = serde_json::to_value(&receipt.outcome).unwrap();
    assert_eq!(stored["kind"], "prepared");
    assert_eq!(
        stored["response"],
        serde_json::to_value(p).unwrap(),
        "the full reply"
    );
}

#[test]
fn a_single_record_prepare_without_a_request_id_keeps_its_v2_label() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    c.prepare(&body(None, "", None).to_string())
        .expect("prepared");
    let env = c.writer.debug_records().pop().unwrap();
    assert!(env.receipt.is_none());
    assert_eq!(env.schema_version, crate::agent_journal::record::SCHEMA_V2);
}

#[test]
fn a_direct_prepare_write_or_fsync_failure_publishes_neither_receipt_nor_reservation() {
    for fsync in [false, true] {
        let dir = tmp();
        let (c, faults) = controller(dir.path());
        let before = observable(&c.writer, dir.path());
        if fsync {
            faults.fail_next_fsyncs(1);
        } else {
            faults.fail_next_appends(1);
        }
        let out = c.prepare(&body(None, "", Some(&request_id())).to_string());
        assert_eq!(
            outcome(&out),
            if fsync { "indeterminate" } else { "refused" }
        );
        let after = observable(&c.writer, dir.path());
        assert!(after.proj.requests.is_empty(), "no receipt");
        assert!(after.reservations.is_empty(), "no reservation");
        assert_eq!(after.proj, before.proj);
    }
}

#[test]
fn a_no_baseline_prepare_that_linearizes_a_pending_capture_takes_the_admission_path() {
    let dir = tmp();
    let (c, faults) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "a\n");
    observe(&c.writer, d, "a\nb\n", None);

    // A failure while the frame is written changes nothing.
    let before = observable(&c.writer, dir.path());
    let rx = c.writer.subscribe();
    faults.fail_next_appends(1);
    let out = c.prepare(&body(Some(head), "a\nb\n", Some(&request_id())).to_string());
    assert_eq!(outcome(&out), "refused");
    assert_eq!(observable(&c.writer, dir.path()), before);
    assert!(appended(&rx).is_empty());

    let p = c
        .prepare(&body(Some(head), "a\nb\n", Some(&request_id())).to_string())
        .expect("prepared");
    assert_eq!(
        p.baseline, None,
        "the linearized observation already holds the buffer"
    );
    let env = c.writer.debug_records().pop().unwrap();
    let Record::Admission { items } = &env.record else {
        panic!("admission path: {env:?}")
    };
    assert_eq!(items.len(), 2, "the linearization and the prepared");
    assert!(items[1].receipt.is_some());
}

/// R103 rule 2: the path is chosen by record count. A buffer equal to the
/// head needs no baseline, yet a pending capture still makes the prepare a
/// multi-record admission rather than a lone `prepared`.
#[test]
fn a_buffer_equal_to_the_head_with_a_pending_capture_is_one_admission_frame() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "a\n");
    let obs = observe(&c.writer, d, "a\nb\n", None);
    let before = c.writer.debug_records().len();

    c.prepare(&body(Some(head), "a\n", Some(&request_id())).to_string())
        .expect("prepared");
    let mut records = c.writer.debug_records();
    assert_eq!(records.len(), before + 1, "exactly one frame appended");
    let env = records.pop().unwrap();
    let Record::Admission { items } = &env.record else {
        panic!("a lone record, not an admission: {env:?}")
    };
    assert!(
        items
            .iter()
            .any(|i| i.txn == obs && matches!(i.record, Record::ObservedRevision { .. })),
        "the observation is linearized inside the frame: {items:?}"
    );
    let last = items.last().unwrap();
    assert!(matches!(last.record, Record::Prepared { .. }) && last.receipt.is_some());
    assert!(c.writer.pending_observations(d).is_empty());
}
