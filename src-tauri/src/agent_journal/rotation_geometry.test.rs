// WI-AL2.1b — the rotation set's geometry: a run shifted left or right through equal text reaches an older hunk several units away and its revert is refused, the one-unit margin on each side blocks an older hunk just beyond the set while one two units away reverts exactly, and the margin widens outward to a whole supplementary-plane character on each side
//! Each test pins one part of `region`: the left shift, the right shift,
//! the margin and the code-point snap. The margin and the snap are the
//! plan's stated conservatism (a break covers the rotation set "plus one
//! unit on each side", "snapped outward to code points"): the hunks they
//! block are refused although no reading of the script moves them.

use super::super::support::*;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::provenance::BreakReason;
use crate::agent_journal::test_review_helpers::revert_planned;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

fn insert_at(at: u64) -> Edit {
    Edit {
        at,
        delete: 0,
        insert: 1,
    }
}

/// An agent change recorded as one hunk; returns its id.
fn older(w: &Writer, doc: DocId, pre: &str, post: &str, edit: Edit) -> HunkId {
    let before = hunk_ids(w, doc);
    agent_change(w, doc, pre, post, edit);
    let fresh: Vec<HunkId> = hunk_ids(w, doc)
        .into_iter()
        .filter(|h| !before.contains(h))
        .collect();
    assert_eq!(fresh.len(), 1, "one new hunk");
    fresh[0].clone()
}

/// A certified `document.write` from the head, its script the one `edit`.
fn write(w: &Writer, docs: &DocRegistry, pre: &str, post: &str, edit: Edit) {
    let doc = docs.resolve(KEY).unwrap();
    let req = Req {
        certificate: Some(cert(pre, post, &[edit])),
        tool: "document.write",
        ..Req::new(w.head(doc), pre)
    };
    let out = commit(w, prepare(w, docs, req).unwrap().txn, post, None).unwrap();
    assert!(out.certified, "{pre:?} → {post:?}: {out:?}");
}

fn refused_by_rotation(w: &Writer, doc: DocId, id: &HunkId) {
    assert_eq!(
        span(w, doc, id).block,
        block(BreakReason::UncertifiedRange, "agent:rotation")
    );
    let err = w.plan_revert(doc, id).unwrap_err();
    assert_eq!(err.code(), "AMBIGUOUS_REVERT", "{err}");
}

/// A fresh journal holding `base` as its first save.
fn journal(base: &str) -> (tempfile::TempDir, Writer, DocRegistry, DocId) {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, base);
    (dir, w, docs, doc)
}

#[test]
fn a_run_shifted_left_through_equal_text_reaches_an_older_hunk() {
    // The older hunk turns "x" into "a"; the script then appends "a". The
    // appended "a" may be any of the four, the older hunk's own included,
    // three units left of where the script put it.
    let (_dir, w, docs, doc) = journal("pxaa");
    let sub = Edit {
        at: 1,
        delete: 1,
        insert: 1,
    };
    let x = older(&w, doc, "pxaa", "paaa", sub);
    write(&w, &docs, "paaa", "paaaa", insert_at(4));
    refused_by_rotation(&w, doc, &x);
    assert_eq!(head_text(&w, doc), "paaaa");
}

#[test]
fn a_run_shifted_right_through_equal_text_reaches_an_older_hunk() {
    // The mirror: the script prepends "a", which may be the older hunk's.
    let (_dir, w, docs, doc) = journal("aaxp");
    let sub = Edit {
        at: 2,
        delete: 1,
        insert: 1,
    };
    let x = older(&w, doc, "aaxp", "aaap", sub);
    write(&w, &docs, "aaap", "aaaap", insert_at(0));
    refused_by_rotation(&w, doc, &x);
    assert_eq!(head_text(&w, doc), "aaaap");
}

#[test]
fn the_margin_blocks_an_older_hunk_one_unit_beyond_the_rotation_set_on_the_left() {
    // "YpXca" + "a": the set is the gaps around the last "a"; "c" stops
    // the shift. X ends one unit before the set, Y three.
    let (_dir, w, docs, doc) = journal("pca");
    let x = older(&w, doc, "pca", "pXca", insert_at(1));
    let y = older(&w, doc, "pXca", "YpXca", insert_at(0));
    write(&w, &docs, "YpXca", "YpXcaa", insert_at(5));
    refused_by_rotation(&w, doc, &x);
    assert_eq!(span(&w, doc, &y).block, None);
    assert_eq!(revert_planned(&w, doc, &y).unwrap(), "pXcaa");
}

#[test]
fn the_margin_blocks_an_older_hunk_one_unit_beyond_the_rotation_set_on_the_right() {
    // "a" + "acXpY": X starts one unit after the set, Y three.
    let (_dir, w, docs, doc) = journal("acp");
    let x = older(&w, doc, "acp", "acXp", insert_at(2));
    let y = older(&w, doc, "acXp", "acXpY", insert_at(4));
    write(&w, &docs, "acXpY", "aacXpY", insert_at(0));
    refused_by_rotation(&w, doc, &x);
    assert_eq!(span(&w, doc, &y).block, None);
    assert_eq!(revert_planned(&w, doc, &y).unwrap(), "aacXp");
}

#[test]
fn the_margin_widens_to_a_whole_supplementary_character_on_the_left() {
    // The unit before the set is the low half of 😀: the margin takes the
    // whole character, so Y, which ends just before it, is blocked.
    let (_dir, w, docs, doc) = journal("😀a");
    let y = older(&w, doc, "😀a", "Y😀a", insert_at(0));
    write(&w, &docs, "Y😀a", "Y😀aa", insert_at(4));
    refused_by_rotation(&w, doc, &y);
}

#[test]
fn the_margin_widens_to_a_whole_supplementary_character_on_the_right() {
    // The unit after the set is the high half of 😀; Y starts just after it.
    let (_dir, w, docs, doc) = journal("a😀");
    let y = older(&w, doc, "a😀", "a😀Y", insert_at(3));
    write(&w, &docs, "a😀Y", "aa😀Y", insert_at(0));
    refused_by_rotation(&w, doc, &y);
}
