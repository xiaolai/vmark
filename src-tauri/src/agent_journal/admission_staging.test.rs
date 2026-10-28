// WI-AL2.2a — an admission is staged on a clone of the projection with its blobs held in memory: the baseline's linearization derives from a preimage the pack does not hold yet, nothing is stored before the frame is whole, and a refused admission leaves every piece of writer-owned state (reservations, degraded queues, window bases, journal and pack) as it was
//! R51 rules 1–3 and R59's refusal clause, through the controller.

use serde_json::json;

use crate::agent_journal::admission::admission_support::*;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::test_support::{agent, human, human_save, open_with, tmp};
use crate::agent_journal::writer::ObserveRequest;

#[test]
fn a_staged_baseline_derives_with_its_preimage_absent_from_the_pack() {
    let dir = tmp();
    let (c, faults) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "kept\n");
    let baseline_text = "kept\nunsaved, never stored\n";
    assert!(!stored_blob(&c.writer, baseline_text));
    let pack_before = pack_len(dir.path());
    let len_before = c.writer.journal_len();

    // The pack refuses the first put. Staging reads the baseline's text to
    // derive its linearization; if it read the pack, staging itself would
    // fail as corrupt. It reaches the put, so it derived from memory.
    faults.fail_next_blob_writes(1);
    let out = c.prepare(&body(Some(head), baseline_text, Some(&request_id())).to_string());
    let err = out.as_ref().expect_err("refused");
    assert_eq!(outcome(&out), "refused");
    assert_eq!(journal_code(err), "JOURNAL_IO", "{err:?}");
    assert!(
        !stored_blob(&c.writer, baseline_text),
        "nothing stored early"
    );
    assert_eq!(pack_len(dir.path()), pack_before, "pack len unchanged");
    assert_eq!(c.writer.journal_len(), len_before);

    let p = c
        .prepare(&body(Some(head), baseline_text, Some(&request_id())).to_string())
        .expect("prepared");
    assert!(p.baseline.is_some(), "a baseline was recorded");
    assert!(
        stored_blob(&c.writer, baseline_text),
        "stored with the frame"
    );
    assert_eq!(c.writer.head(d), p.baseline);
}

#[test]
fn a_refused_admission_leaves_reservations_queues_and_window_bases_unchanged() {
    let dir = tmp();
    let (c, faults) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "base\n");

    // A window base on the document, through a pending capture the
    // admission would linearize.
    c.writer
        .observe_for_window(
            ObserveRequest {
                doc: d,
                actor: human(),
                initiator: human(),
                postimage: "base\nsaved\n".into(),
                observed_parent: ObservedRef::Revision { revision: head },
                provenance: None,
            },
            Some("window-1"),
        )
        .expect("observe");
    // A reservation on another document.
    let other = json!({
        "docKey": "path:/notes/other.md",
        "parent": null,
        "preimage": "",
        "actor": agent(),
        "tool": "document.write",
    });
    c.prepare(&other.to_string())
        .expect("reserve the other document");
    // A degraded queue on a third.
    let third = c.docs.resolve("path:/notes/third.md").unwrap();
    faults.fail_next_appends(1);
    let q = c
        .writer
        .observe(ObserveRequest {
            doc: third,
            actor: human(),
            initiator: human(),
            postimage: "queued\n".into(),
            observed_parent: ObservedRef::Genesis,
            provenance: None,
        })
        .expect("queued");
    assert_eq!(
        q.journaled,
        crate::agent_journal::writer_observe::Journaled::No
    );

    let before = observable(&c.writer, dir.path());
    assert_eq!(before.reservations.len(), 1);
    assert_eq!(before.degraded.len(), 1);
    assert_eq!(before.window_bases.len(), 1);

    faults.fail_next_appends(1);
    let out = c.prepare(
        &body(
            Some(head),
            "base\nsaved\nand unsaved\n",
            Some(&request_id()),
        )
        .to_string(),
    );
    assert_eq!(outcome(&out), "refused", "{out:?}");

    let after = observable(&c.writer, dir.path());
    assert_eq!(after.reservations, before.reservations, "reservations");
    assert_eq!(after.degraded, before.degraded, "degraded queues");
    assert_eq!(after.window_bases, before.window_bases, "window bases");
    assert_eq!(after.journal_len, before.journal_len, "journal_len");
    assert_eq!(after.proj, before.proj);
    // The staged blobs were stored before the refused write: orphan-pack
    // growth is a legitimate exception (R59), so the pack is not compared.
    // Everything else R51 and R59 list is: queued windows, unpinned sets,
    // released labels, the fallback counter.
    assert_eq!(
        Observable {
            pack_len: before.pack_len,
            ..after
        },
        before
    );
    assert_eq!(c.writer.pending_observations(d).len(), 1, "still pending");
}

#[test]
fn a_reopened_writer_reads_the_staged_frame_with_its_blobs() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "x\n");
    let p = c
        .prepare(&body(Some(head), "x\ny\n", Some(&request_id())).to_string())
        .expect("prepared");
    drop(c);
    let (w, _) = open_with(dir.path(), SyncPolicy::Full);
    assert!(stored_blob(&w, "x\ny\n"));
    assert_eq!(w.head(d), p.baseline);
}

/// An admission applies item by item, so only its staged clone may become
/// live: a frame handed to the writer without one is refused unwritten.
#[test]
fn an_admission_without_its_staged_projection_is_refused_unwritten() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let (frame, _) = super::admission_shape_tests::valid_admission();
    let (len, proj) = (c.writer.journal_len(), c.writer.lock().proj.clone());
    let err = {
        let mut g = c.writer.lock();
        c.writer.publish_record(&mut g, frame).unwrap_err()
    };
    assert_eq!(err.code(), "INVARIANT_BROKEN", "{err:?}");
    assert_eq!(c.writer.journal_len(), len, "nothing written");
    assert_eq!(c.writer.lock().proj, proj, "nothing applied");
}
