//! A durable window capture moves the window's base under the same lock as
//! its append, so rapid captures of one window can never leave an older
//! observation as the live base; a capture whose observed preimage is its
//! own postimage queues that text once, not twice; a capture whose text
//! is already stored queues none of it, yet keeps it as a root.

use crate::agent_journal::capture_tests::setup;
use crate::agent_journal::ids::{BlobHash, DocId, TxnId};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::test_support::human;
use crate::agent_journal::writer::{Journaled, ObserveRequest, RetentionBudget, Writer};

fn save(w: &Writer, doc: DocId, text: &str, base: ObservedRef, window: &str) -> TxnId {
    let out = w
        .observe_for_window(
            ObserveRequest {
                doc,
                actor: human(),
                initiator: human(),
                postimage: text.into(),
                observed_parent: base,
                provenance: None,
            },
            Some(window),
        )
        .expect("observe");
    assert_eq!(out.journaled, Journaled::Pending);
    out.observation
}

fn base_of(w: &Writer, window: &str) -> Option<ObservedRef> {
    w.lock().window_bases.get(window).map(|(_, b)| b.clone())
}

#[test]
fn a_durable_capture_moves_its_window_base_before_the_lock_is_released() {
    let (_dir, w, _c, _) = setup();
    let doc = DocId::new();
    let a = save(&w, doc, "a", ObservedRef::Genesis, "main/t1@a");
    assert_eq!(
        base_of(&w, "main/t1@a"),
        Some(ObservedRef::Pending { observation: a })
    );
}

#[test]
fn a_late_registration_of_an_older_capture_never_replaces_a_newer_base() {
    let (_dir, w, _c, _) = setup();
    let doc = DocId::new();
    let a = save(&w, doc, "a", ObservedRef::Genesis, "main/t1@a");
    let b = save(
        &w,
        doc,
        "ab",
        ObservedRef::Pending { observation: a },
        "main/t1@a",
    );
    // Capture A's caller registers its base only now, after B landed.
    w.register_window_base("main/t1@a", doc, ObservedRef::Pending { observation: a });
    assert_eq!(
        base_of(&w, "main/t1@a"),
        Some(ObservedRef::Pending { observation: b })
    );
}

fn queue(w: &Writer, doc: DocId, text: &str, base: ObservedRef) -> TxnId {
    let out = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: text.into(),
            observed_parent: base,
            provenance: None,
        })
        .expect("queued");
    assert_eq!(out.journaled, Journaled::No);
    out.observation
}

#[test]
fn an_observed_preimage_equal_to_the_postimage_is_queued_once() {
    let (_dir, w, _c, faults) = setup();
    let doc = DocId::new();
    faults.fail_next_appends(1_000);
    let first = queue(&w, doc, "a", ObservedRef::Genesis);
    // Behind `first`, so never appended: its text lives only in the queue.
    let text = "y".repeat(100);
    let second = queue(&w, doc, &text, ObservedRef::Pending { observation: first });
    w.set_retention_budget(RetentionBudget {
        degraded_entries: 8,
        degraded_bytes: 250,
        window_bases: 16,
    });
    // An unchanged save on top of `second`: preimage and postimage are one
    // text, 100 bytes, which fits beside the 101 already queued.
    queue(
        &w,
        doc,
        &text,
        ObservedRef::Pending {
            observation: second,
        },
    );
    let g = w.lock();
    let last = g.degraded[&doc].back().expect("the capture is queued");
    assert_eq!(last.blobs.len(), 1, "one text, stored once");
}

#[test]
fn a_capture_whose_text_is_stored_queues_no_text_and_keeps_it_rooted() {
    let (_dir, w, _c, faults) = setup();
    let doc = DocId::new();
    w.set_retention_budget(RetentionBudget {
        degraded_entries: 8,
        degraded_bytes: 50,
        window_bases: 16,
    });
    // The blob lands, then the journal append fails: the text is durable,
    // so it needs no queue bytes, and 100 of them would not fit in 50.
    faults.fail_next_appends(1);
    let text = "z".repeat(100);
    let obs = queue(&w, doc, &text, ObservedRef::Genesis);
    let hash = BlobHash::of_text(&text);
    {
        let mut g = w.lock();
        assert!(g.degraded[&doc].back().expect("queued").blobs.is_empty());
        crate::agent_journal::writer_gc::compact_unreached(&mut g).expect("compact");
        assert!(g.blobs.contains(&hash), "a queued capture roots its text");
    }
    assert!(w.retry_degraded(doc).expect("drain"));
    assert!(w.snapshot().state.observations.contains_key(&obs));
    assert_eq!(w.lock().blobs.get(&hash).expect("stored"), text);
}
