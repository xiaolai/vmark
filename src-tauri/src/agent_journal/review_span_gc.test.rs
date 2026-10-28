// WI-AL2.3 — eager span mapping survives retention: a pending hunk after 501 disjoint human (`none`-op) revisions and the default GC still maps exactly, and an overlapping revision after the collection marks it edited since, still pending and still mapped
//! Spans are mapped eagerly at every record, so collecting the revisions
//! they were mapped through loses nothing.

use crate::agent_journal::ids::DocId;
use crate::agent_journal::review::HunkState;
use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer_gc::GcPolicy;

#[test]
fn a_pending_hunk_maps_after_501_disjoint_human_revisions_and_gc() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    // Each save inserts one `z` before the hunks: every span shifts by one.
    for _ in 0..501 {
        let text = format!("z{}", head_text(&w, doc));
        human_edit(
            &w,
            doc,
            &text,
            &[Edit {
                at: 0,
                delete: 0,
                insert: 1,
            }],
        );
    }
    let report = w.collect(&GcPolicy::default()).expect("collect");
    assert!(!report.collected.is_empty(), "past the 500-revision cap");
    let span = |w: &crate::agent_journal::writer::Writer| {
        w.snapshot().state.docs[&doc].hunks[&a].span.clone()
    };
    assert_eq!(
        (span(&w).range, span(&w).edited_since),
        (r(501, 502), false)
    );
    // Overwrite A's `x` with `w`: the overlap keeps the hunk actionable.
    let head = head_text(&w, doc);
    let text = format!("{}w{}", &head[..501], &head[502..]);
    human_edit(
        &w,
        doc,
        &text,
        &[Edit {
            at: 501,
            delete: 1,
            insert: 1,
        }],
    );
    assert_eq!(state(&w, doc, &a).0, HunkState::Pending);
    assert_eq!((span(&w).range, span(&w).edited_since), (r(501, 502), true));
}
