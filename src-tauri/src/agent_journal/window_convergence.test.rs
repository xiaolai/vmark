// WI-AL1.2 — two windows converge on one journal and lose no entries after compaction: each window hydrates (subscribe, then snapshot), follows appends in order, refetches on the compaction's resync or a lost broadcast, and ends equal to the writer and to a restart
//! Windows are `HydratedView`s over one writer. One follows every append as
//! it lands; the other only catches up after the compaction, so it meets
//! the `Resync`. A third hydrates after the compaction and loses a
//! broadcast. All three must equal the writer's projection, keep every
//! revision the collection retained, and match what a restart replays.
use super::test_support::*;
use crate::agent_journal::hydration::HydratedView;
use crate::agent_journal::ids::{DocId, RevisionId};
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

fn saves(w: &Writer, doc: DocId, from: usize, n: usize) -> Vec<RevisionId> {
    (from..from + n)
        .map(|i| human_save(w, doc, &format!("text {i}")))
        .collect()
}

fn settle(w: &Writer, doc: DocId) {
    if let Some(epoch) = w.epoch(doc) {
        w.close_epoch(doc, epoch).expect("close epoch");
    }
}

#[test]
fn two_windows_converge_and_lose_no_entries_after_compaction() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let (doc, other) = (DocId::new(), DocId::new());
    let mut live = HydratedView::hydrate(&w);
    let mut late = HydratedView::hydrate(&w);
    let before = saves(&w, doc, 0, 6);
    live.pump(&w).expect("pump");
    assert_eq!(live.refetches, 0, "appends in order need no refetch");

    let policy = GcPolicy {
        max_revisions: 3,
        ..GcPolicy::default()
    };
    let collected = w.collect(&policy).expect("compaction").collected;
    assert_eq!(collected, before[..3].to_vec());
    let after = saves(&w, doc, 6, 3);
    let elsewhere = saves(&w, other, 0, 2);
    let mut joined = HydratedView::hydrate(&w);
    faults.drop_next_broadcasts(1);
    let lost = human_save(&w, other, "lost broadcast");
    human_save(&w, other, "next");

    for (name, view) in [
        ("live", &mut live),
        ("late", &mut late),
        ("joined", &mut joined),
    ] {
        view.pump(&w).expect("pump");
        let snap = w.snapshot();
        assert_eq!(view.generation, snap.generation, "{name}: generation");
        assert_eq!(
            view.state, snap.state,
            "{name}: same projection as the writer"
        );
        assert!(
            view.refetches >= 1,
            "{name}: the resync or the gap was noticed"
        );
        let retained = before[3..]
            .iter()
            .chain(&after)
            .chain(&elsewhere)
            .chain([&lost]);
        for r in retained {
            let meta = view.state.revisions.get(r).expect("entry kept");
            assert!(!meta.collected, "{name}: {r:?} retained");
        }
        for r in &collected {
            assert!(
                view.state.revisions[r].collected,
                "{name}: {r:?} tombstoned"
            );
        }
    }
    assert_eq!(live.state, late.state);

    settle(&w, doc);
    settle(&w, other);
    let mut view = HydratedView::hydrate(&w);
    view.pump(&w).expect("pump");
    drop(w);
    let (reopened, _) = open(dir.path());
    assert_eq!(
        reopened.snapshot().state,
        view.state,
        "a restart replays the same entries"
    );
}

#[test]
fn a_view_whose_writer_is_gone_resubscribes_and_refetches_instead_of_going_stale() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "before");
    let mut view = HydratedView::hydrate(&w);
    drop(w);
    let (reopened, _) = open(dir.path());
    human_save(&reopened, doc, "after the reopen");
    view.pump(&reopened).expect("pump");
    assert_eq!(view.generation, reopened.snapshot().generation);
    assert_eq!(view.state, reopened.snapshot().state);
    assert_eq!(view.refetches, 1, "a disconnected feed is one refetch");
    // The view now follows the live writer.
    human_save(&reopened, doc, "followed");
    view.pump(&reopened).expect("pump");
    assert_eq!(view.state, reopened.snapshot().state);
    assert_eq!(view.refetches, 1, "the next append is applied in order");
}
