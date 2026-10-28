// WI-AL2.0m — a rebuilt `main` registers its base roots again: reopening a destroyed app window's label admits new names under it, keeps every released name refused, and keeps the collector off a revision only the rebuilt window pins
//! `ensure_main_window` rebuilds the fixed label `main` after the old one
//! was destroyed. Releasing a label refuses every later name under it, so
//! the rebuild must reopen the label, or the new window's bases are never
//! pinned and the collector may take the text it still edits on.

use crate::agent_journal::ids::{DocId, RevisionId};
use crate::agent_journal::pins::PinReason;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::test_support::{human_save, open, tmp};
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

fn base(revision: RevisionId) -> ObservedRef {
    ObservedRef::Revision { revision }
}

fn saves(w: &Writer, doc: DocId, n: usize) -> Vec<RevisionId> {
    (0..n)
        .map(|i| human_save(w, doc, &format!("text {i} 中文")))
        .collect()
}

fn pinned_by(w: &Writer, rev: RevisionId, name: &str) -> bool {
    w.pins()
        .revisions
        .get(&rev)
        .is_some_and(|why| why.contains(&PinReason::WindowBase(name.into())))
}

/// The rebuilt `main` holds a base revision that only its window base
/// pins; the head moves on and the collector runs. The revision's text
/// must stay readable.
#[test]
fn the_collector_keeps_a_revision_only_the_rebuilt_main_pins() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let revs = saves(&w, doc, 2);
    w.register_window_base("main/t1@a", doc, base(revs[1]));
    w.release_window_label("main");
    let more = saves(&w, doc, 5);
    w.reopen_window_label("main");
    w.register_window_base("main/t2@b", doc, base(revs[0]));
    w.register_window_base("doc-2/t1@c", doc, base(more[4]));
    let report = w
        .collect(&GcPolicy {
            max_revisions: 2,
            ..GcPolicy::default()
        })
        .expect("collect");
    assert!(report.deferred.is_none(), "{report:?}");
    let state = w.snapshot().state;
    let kept = &state.revisions[&revs[0]];
    assert!(!kept.collected, "the rebuilt main's base was collected");
    assert_eq!(
        w.blob_text(&kept.postimage)
            .expect("its text stays readable"),
        "text 0 中文"
    );
}

#[test]
fn a_reopened_label_admits_new_names_and_still_refuses_released_ones() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let revs = saves(&w, doc, 2);
    w.register_window_base("main/t1@a", doc, base(revs[0]));
    w.release_window_label("main");
    w.reopen_window_label("main");
    w.register_window_base("main/t2@b", doc, base(revs[1]));
    w.register_window_base("main/t1@a", doc, base(revs[0]));
    let names: Vec<String> = w.lock().window_bases.keys().cloned().collect();
    assert_eq!(names, ["main/t2@b"], "a released name stays refused");
    assert!(pinned_by(&w, revs[1], "main/t2@b"));
    assert!(!pinned_by(&w, revs[0], "main/t1@a"));
}

#[test]
fn reopening_is_idempotent_and_a_no_op_for_a_label_never_released() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let revs = saves(&w, doc, 1);
    w.reopen_window_label("main"); // nothing remembered
    w.reopen_window_label("");
    assert!(w.lock().released.is_empty());
    w.register_window_base("main/t1@a", doc, base(revs[0]));
    w.release_window_label("main");
    let released = w.lock().released.clone();
    w.reopen_window_label("main");
    w.reopen_window_label("main");
    let left: Vec<String> = w.lock().released.iter().cloned().collect();
    assert_eq!(left, ["main/t1@a"], "only the bare label is forgotten");
    assert_eq!(released.len(), 2);
    w.reopen_window_label("main/t1@a"); // a name is not a label
    assert_eq!(w.lock().released.len(), 1, "names are never forgotten");
}

/// The accepted residual: a capture of the old `main`, in flight across the
/// rebuild, names a tab the old window never registered. After the reopen
/// it registers and over-pins one stale base, until `main` is destroyed
/// again: that release drops it.
#[test]
fn a_late_capture_after_the_reopen_registers_until_main_is_released_again() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let revs = saves(&w, doc, 2);
    w.register_window_base("main/t1@a", doc, base(revs[1]));
    w.release_window_label("main");
    w.reopen_window_label("main");
    w.register_window_base("main/t9@late", doc, base(revs[0]));
    assert!(pinned_by(&w, revs[0], "main/t9@late"), "over-pinned, kept");
    w.release_window_label("main");
    assert!(w.lock().window_bases.is_empty());
    assert!(!pinned_by(&w, revs[0], "main/t9@late"));
}
