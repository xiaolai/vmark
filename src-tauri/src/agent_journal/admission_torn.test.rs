// WI-AL2.2a — the torn-append matrix for a real multi-item admission: a torn write rolled back cleanly at several offsets leaves the logical state unchanged and a shorter plain append then lands; a failed truncate or a failed rollback sync poisons, nothing persists, captures queue and the drainer returns Ok(false), and reopen drops the torn frame whole; a refused admission leaves the unpinned window sets of a window over the base budget unchanged
//! R59's tests, through the controller.

use crate::agent_journal::admission::admission_support::*;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::test_support::{config, human, human_save, observe, tmp};
use crate::agent_journal::writer::{ObserveRequest, Writer};
use crate::agent_journal::writer_budget::RetentionBudget;
use crate::agent_journal::writer_observe::Journaled;

/// A document with a pending capture and a dirty buffer: its prepare is
/// a four-item admission (linearization, baseline pair, prepared).
fn dirty(c: &Controller) -> DocId {
    let d = doc(c);
    human_save(&c.writer, d, "base\n");
    observe(&c.writer, d, "base\nsaved\n", None);
    close_epoch(&c.writer, d);
    d
}

fn admission_payload(c: &Controller) -> String {
    body(
        c.writer.head(doc(c)),
        "base\nsaved\nunsaved\n",
        Some(&request_id()),
    )
    .to_string()
}

/// A human capture of a fresh document: a record far shorter than the frame.
fn plain_capture(w: &Writer) -> (DocId, Journaled) {
    let other = DocId::new();
    let out = w
        .observe(ObserveRequest {
            doc: other,
            actor: human(),
            initiator: human(),
            postimage: "x".into(),
            observed_parent: ObservedRef::Genesis,
            provenance: None,
        })
        .expect("observe");
    (other, out.journaled)
}

#[test]
fn a_torn_admission_rolled_back_at_any_offset_leaves_state_and_a_shorter_append_lands() {
    for tear in [1, 7, 64, 255] {
        let dir = tmp();
        let (c, faults) = controller(dir.path());
        dirty(&c);
        let before = observable(&c.writer, dir.path());
        let rx = c.writer.subscribe();

        faults.tear_next_append_after(tear);
        let out = c.prepare(&admission_payload(&c));
        assert_eq!(outcome(&out), "refused", "tear {tear}: {out:?}");
        let after = observable(&c.writer, dir.path());
        assert_eq!(
            after.journal_len, before.journal_len,
            "tear {tear}: rolled back"
        );
        assert_eq!(
            Observable {
                pack_len: before.pack_len,
                ..after
            },
            before,
            "tear {tear}: logical state unchanged (orphan-pack growth excepted, R59)"
        );
        assert!(appended(&rx).is_empty(), "tear {tear}: no events");
        c.writer
            .health()
            .expect("a clean rollback keeps the writer healthy");

        let (other, journaled) = plain_capture(&c.writer);
        assert_eq!(
            journaled,
            Journaled::Pending,
            "tear {tear}: the shorter append lands"
        );
        assert!(
            c.writer.retry_degraded(other).expect("drain"),
            "nothing queued"
        );
        assert!(
            c.prepare(&admission_payload(&c)).is_ok(),
            "tear {tear}: the admission itself is writable again"
        );
        close_epoch(&c.writer, other);
        let live = c.writer.lock().proj.clone();
        drop(c);
        let (w, report) = Writer::open(config(dir.path(), SyncPolicy::Full).0).expect("reopen");
        assert_eq!(
            report.truncated_tail_bytes, 0,
            "tear {tear}: no torn bytes left"
        );
        // The open prepare is recovered as uncommitted at reopen.
        let replayed = w.lock().proj.clone();
        assert_eq!(replayed.requests, live.requests, "tear {tear}");
        assert_eq!(replayed.revisions, live.revisions, "tear {tear}");
    }
}

/// Tear the admission and fail its rollback with `fault`: the journal is
/// poisoned, the reply indeterminate, and nothing after it persists.
/// `torn_at_reopen`: the bytes reopen still finds (none when the truncate
/// itself succeeded and only its sync failed).
fn poisoned_by(fault: fn(&Faults), torn_at_reopen: u64) {
    let dir = tmp();
    let (c, faults) = controller(dir.path());
    let d = dirty(&c);
    let before = observable(&c.writer, dir.path());
    let records = c.writer.debug_records().len();

    faults.tear_next_append_after(9);
    fault(&faults);
    let out = c.prepare(&admission_payload(&c));
    assert_eq!(outcome(&out), "indeterminate", "{out:?}");
    assert_eq!(c.writer.health().unwrap_err().code(), "JOURNAL_DEGRADED");
    let after = observable(&c.writer, dir.path());
    assert_eq!(after.proj, before.proj, "the live state is unchanged");
    assert_eq!(after.reservations, before.reservations);

    let (other, journaled) = plain_capture(&c.writer);
    assert_eq!(journaled, Journaled::No, "the shorter capture queues");
    assert!(
        !c.writer.retry_degraded(other).expect("drain"),
        "the drainer stops"
    );
    assert_eq!(c.writer.pending_observations(d).len(), 1, "still pending");
    drop(c);

    let (w, report) = Writer::open(config(dir.path(), SyncPolicy::Full).0).expect("reopen");
    assert_eq!(
        report.truncated_tail_bytes, torn_at_reopen,
        "the torn frame is dropped whole"
    );
    let all = w.debug_records();
    assert_eq!(all.len(), records, "nothing after it persisted");
    assert!(
        !all.iter()
            .any(|e| matches!(e.record, Record::Admission { .. })),
        "no admission"
    );
    assert!(w.lock().proj.requests.is_empty(), "no receipt");
}

#[test]
fn a_torn_admission_whose_truncate_fails_poisons_and_persists_nothing() {
    poisoned_by(|f| f.fail_next_truncates(1), 9);
}

#[test]
fn a_torn_admission_whose_rollback_sync_fails_poisons_and_persists_nothing() {
    poisoned_by(|f| f.fail_next_rollback_syncs(1), 0);
}

#[test]
fn a_refused_admission_leaves_the_unpinned_windows_of_an_over_budget_window() {
    let dir = tmp();
    let (c, faults) = controller(dir.path());
    let d = dirty(&c);
    c.writer.set_retention_budget(RetentionBudget {
        window_bases: 2,
        ..RetentionBudget::default()
    });
    // One window past the budget: unpinned, with room left in every set, so a
    // registration the refusal failed to undo would show.
    for window in ["main/t1@a", "doc-2/t1@b", "doc-3/t1@c"] {
        c.writer
            .observe_for_window(
                ObserveRequest {
                    doc: DocId::new(),
                    actor: human(),
                    initiator: human(),
                    postimage: window.into(),
                    observed_parent: ObservedRef::Genesis,
                    provenance: None,
                },
                Some(window),
            )
            .expect("observe");
    }
    let before = observable(&c.writer, dir.path());
    assert!(
        before.unpinned == ["doc-3/t1@c"]
            && before.unpinned_labels.is_empty()
            && !before.unpinned_overflow,
        "{before:?}"
    );

    faults.fail_next_appends(1);
    let out = c.prepare(&admission_payload(&c));
    assert_eq!(outcome(&out), "refused", "{out:?}");
    let after = observable(&c.writer, dir.path());
    assert_eq!(
        Observable {
            pack_len: before.pack_len,
            ..after
        },
        before
    );
    assert_eq!(c.writer.pending_observations(d).len(), 1);
}
