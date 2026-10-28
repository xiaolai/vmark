// WI-AL2.1b — the declared-script certificate of a whole-text agent write: one bounded rotation break per changed run blocks an older hunk whose edge the run can rotate through (aZ/Za) while a disjoint older hunk reverts exactly, the far-copy fixtures revert by the contract, independent runs stay separate hunks, a non-reproducing script falls back, a selection.set carries no rotation break, and the rotation breaks count against the certificate's cap
//! Rotation breaks (R27 step 2, R42 step 8). Edge cases: a run at the end
//! of the text, CJK and supplementary-plane copies, a cap met exactly.

use super::super::support::*;
use super::super::FallbackReason;
use crate::agent_journal::controlled::ControlledCommitted;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::provenance::{BreakReason, Provenance};
use crate::agent_journal::test_review_helpers::revert_planned;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

fn units(s: &str) -> u64 {
    s.encode_utf16().count() as u64
}

/// A whole-text write `pre → post` from the head, its script `edits`.
fn declared(
    w: &Writer,
    docs: &DocRegistry,
    tool: &str,
    pre: &str,
    post: &str,
    certificate: serde_json::Value,
) -> ControlledCommitted {
    let doc = docs.resolve(KEY).unwrap();
    let p = prepare(
        w,
        docs,
        Req {
            certificate: Some(certificate),
            tool,
            ..Req::new(w.head(doc), pre)
        },
    )
    .unwrap();
    commit(w, p.txn, post, None).unwrap()
}

/// The one hunk `ids` gained.
fn new_id(before: &[HunkId], after: Vec<HunkId>) -> HunkId {
    let mut fresh: Vec<HunkId> = after.into_iter().filter(|h| !before.contains(h)).collect();
    assert_eq!(fresh.len(), 1, "one new hunk");
    fresh.remove(0)
}

/// An agent change recorded as one hunk; returns its id.
fn older(w: &Writer, doc: DocId, pre: &str, post: &str, edit: Edit) -> HunkId {
    let before = hunk_ids(w, doc);
    agent_change(w, doc, pre, post, edit);
    new_id(&before, hunk_ids(w, doc))
}

/// "pq\n\na" with older hunks Y (at 1) and Z (at the end): "pYq\n\naZ".
fn az_fixture(w: &Writer, docs: &DocRegistry) -> (DocId, HunkId, HunkId) {
    let doc = docs.resolve(KEY).unwrap();
    human_save(w, doc, "pq\n\na");
    let ins = |at| Edit {
        at,
        delete: 0,
        insert: 1,
    };
    let y = older(w, doc, "pq\n\na", "pYq\n\na", ins(1));
    let z = older(w, doc, "pYq\n\na", "pYq\n\naZ", ins(6));
    (doc, y, z)
}

fn az_write() -> serde_json::Value {
    // The script appends "aZ"; "Za" after the older Z is the same text.
    cert(
        "pYq\n\naZ",
        "pYq\n\naZaZ",
        &[Edit {
            at: 7,
            delete: 0,
            insert: 2,
        }],
    )
}

#[test]
fn az_za_refuses_the_rotating_hunk_and_reverts_the_disjoint_one_exactly() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, y, z) = az_fixture(&w, &docs);
    let (pre, post) = ("pYq\n\naZ", "pYq\n\naZaZ");
    // The same texts also read as "Za" inserted after the "a" the older Z follows.
    assert_eq!(format!("{}{}{}", &pre[..6], "Za", &pre[6..]), post);
    let out = declared(&w, &docs, "document.write", pre, post, az_write());
    assert!(out.certified, "{out:?}");
    assert_eq!(
        span(&w, doc, &z).block,
        block(BreakReason::UncertifiedRange, "agent:rotation")
    );
    let err = w.plan_revert(doc, &z).unwrap_err();
    assert_eq!(err.code(), "AMBIGUOUS_REVERT", "{err}");
    assert_eq!(span(&w, doc, &y).block, None);
    assert_eq!(revert_planned(&w, doc, &y).unwrap(), "pq\n\naZaZ");
    assert_eq!(head_text(&w, doc), "pq\n\naZaZ");
    assert_eq!(w.uncertified_fallbacks(), 0);
}

#[test]
fn a_selection_set_certificate_carries_no_rotation_break() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, _, z) = az_fixture(&w, &docs);
    let out = declared(
        &w,
        &docs,
        "selection.set",
        "pYq\n\naZ",
        "pYq\n\naZaZ",
        az_write(),
    );
    assert!(out.certified, "{out:?}");
    assert_eq!(span(&w, doc, &z).block, None);
    assert_eq!(revert_planned(&w, doc, &z).unwrap(), "pYq\n\naaZ");
}

#[test]
fn every_whole_text_tool_declares_its_script() {
    for tool in [
        "document.write",
        "document.transform",
        "workflow.apply_patch",
    ] {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let docs = DocRegistry::default();
        let (doc, _, z) = az_fixture(&w, &docs);
        declared(&w, &docs, tool, "pYq\n\naZ", "pYq\n\naZaZ", az_write());
        assert_eq!(
            w.plan_revert(doc, &z).unwrap_err().code(),
            "AMBIGUOUS_REVERT",
            "{tool}"
        );
    }
}

/// `S = prefix + "h" + suffix`; the base holds "H" where S holds "h".
fn far_copy(prefix: &str, suffix: &str) -> String {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    let s = format!("{prefix}h{suffix}");
    let base = format!("{prefix}H{suffix}X");
    human_save(&w, doc, &base);
    let at = units(prefix);
    let one = Edit {
        at,
        delete: 1,
        insert: 1,
    };
    let h = older(&w, doc, &base, &format!("{s}X"), one);
    // The declared script keeps S, deletes "X" and inserts "Y" + S.
    let post = format!("{s}Y{s}");
    let edit = Edit {
        at: units(&s),
        delete: 1,
        insert: 1 + units(&s),
    };
    let pre = format!("{s}X");
    let out = declared(
        &w,
        &docs,
        "document.write",
        &pre,
        &post,
        cert(&pre, &post, &[edit]),
    );
    assert!(out.certified, "{out:?}");
    let bang = format!("!{post}");
    human_edit(
        &w,
        doc,
        &bang,
        &[Edit {
            at: 0,
            delete: 0,
            insert: 1,
        }],
    );
    // Contractual, not a guess: the declared script is the operation, so
    // the older hunk is the copy the script kept, and its revert restores
    // "H" there even though the inserted copy also holds an "h".
    let reverted = revert_planned(&w, doc, &h).unwrap();
    assert_eq!(reverted, format!("!{prefix}H{suffix}Y{s}"));
    reverted
}

#[test]
fn the_far_copy_reverts_the_kept_copy_by_contract() {
    assert_eq!(
        far_copy("ABCDEFG", "IJKLMNO"),
        "!ABCDEFGHIJKLMNOYABCDEFGhIJKLMNO"
    );
}

#[test]
fn the_far_copy_reverts_by_contract_in_cjk_and_the_supplementary_plane() {
    far_copy("甲乙丙丁戊己庚", "辛壬癸");
    far_copy("𠀀😀𠀁𠀂", "😁𠀃");
}

#[test]
fn independent_runs_are_separate_hunks_that_each_revert_exactly() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "ab12cd");
    let sub = |at| Edit {
        at,
        delete: 1,
        insert: 1,
    };
    let c = cert("ab12cd", "aX12Yd", &[sub(1), sub(4)]);
    let out = declared(&w, &docs, "document.write", "ab12cd", "aX12Yd", c);
    assert!(out.certified, "{out:?}");
    let mut ids = hunk_ids(&w, doc);
    assert_eq!(ids.len(), 2, "one hunk per run, never grouped");
    let s = w.snapshot().state;
    ids.sort_by_key(|id| s.docs[&doc].hunks[id].hunk.target_range.start);
    let ins = Edit {
        at: 3,
        delete: 0,
        insert: 1,
    };
    human_edit(&w, doc, "aX1!2Yd", &[ins]);
    assert_eq!(revert_planned(&w, doc, &ids[0]).unwrap(), "ab1!2Yd");
    assert_eq!(revert_planned(&w, doc, &ids[1]).unwrap(), "ab1!2cd");
}

#[test]
fn a_whole_emoji_run_is_one_hunk_that_reverts_exactly() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "a😀b");
    let e = Edit {
        at: 1,
        delete: 2,
        insert: 2,
    };
    let out = declared(
        &w,
        &docs,
        "document.write",
        "a😀b",
        "a😁b",
        cert("a😀b", "a😁b", &[e]),
    );
    assert!(out.certified, "{out:?}");
    let ids = hunk_ids(&w, doc);
    assert_eq!(ids.len(), 1);
    assert_eq!(revert_planned(&w, doc, &ids[0]).unwrap(), "a😀b");
}

#[test]
fn one_trimmed_run_blocks_only_its_neighbourhood() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "abcdefgh");
    let sub = |at| Edit {
        at,
        delete: 1,
        insert: 1,
    };
    let a = older(&w, doc, "abcdefgh", "Abcdefgh", sub(0));
    let h = older(&w, doc, "Abcdefgh", "AbcdefgH", sub(7));
    // The trimmed fallback's one coarse run: "de" → "wxyz".
    let e = Edit {
        at: 3,
        delete: 2,
        insert: 4,
    };
    let (pre, post) = ("AbcdefgH", "AbcwxyzfgH");
    declared(
        &w,
        &docs,
        "document.write",
        pre,
        post,
        cert(pre, post, &[e]),
    );
    assert_eq!(span(&w, doc, &a).block, None);
    assert_eq!(span(&w, doc, &h).block, None);
    assert_eq!(revert_planned(&w, doc, &a).unwrap(), "abcwxyzfgH");
    assert_eq!(revert_planned(&w, doc, &h).unwrap(), "abcwxyzfgh");
}

#[test]
fn a_non_reproducing_script_falls_back_to_a_counted_barrier() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, y, _) = az_fixture(&w, &docs);
    // The script appends "aZ"; the editor produced "aY".
    let out = declared(
        &w,
        &docs,
        "document.write",
        "pYq\n\naZ",
        "pYq\n\naZaY",
        az_write(),
    );
    assert!(!out.certified && out.applied && out.durable, "{out:?}");
    assert_eq!(out.fallback_reason, Some(FallbackReason::NotThePostimage));
    assert_eq!(
        span(&w, doc, &y).block,
        block(BreakReason::WholeDocumentWrite, "agent")
    );
    assert_eq!(head_text(&w, doc), "pYq\n\naZaY");
    assert_eq!(w.uncertified_fallbacks(), 1);
}

/// The az write's certificate with `cap`, and the entries its window
/// holds once one rotation break per run is added.
fn az_write_capped(cap: u64) -> serde_json::Value {
    let (pre, post) = ("pYq\n\naZ", "pYq\n\naZaZ");
    let mut p = Provenance::new(units(pre) as i64, cap).unwrap();
    p.compose(&[section(Edit {
        at: 7,
        delete: 0,
        insert: 2,
    })])
    .unwrap();
    cert_of(pre, post, &p)
}

fn entries_with_rotation() -> u64 {
    let p = window(
        "pYq\n\naZ",
        &[Edit {
            at: 7,
            delete: 0,
            insert: 2,
        }],
    );
    p.entries() as u64 + p.changed_runs().len() as u64
}

#[test]
fn rotation_breaks_count_against_the_cap_met_exactly_and_exceeded_by_one() {
    let cap = entries_with_rotation();
    for (cap, certified) in [(cap, true), (cap - 1, false)] {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let docs = DocRegistry::default();
        let (doc, y, _) = az_fixture(&w, &docs);
        let out = declared(
            &w,
            &docs,
            "document.write",
            "pYq\n\naZ",
            "pYq\n\naZaZ",
            az_write_capped(cap),
        );
        assert_eq!(out.certified, certified, "cap {cap}: {out:?}");
        if certified {
            assert_eq!(out.fallback_reason, None);
            assert_eq!(w.uncertified_fallbacks(), 0);
            assert_eq!(span(&w, doc, &y).block, None);
        } else {
            assert_eq!(out.fallback_reason, Some(FallbackReason::OverCap));
            assert_eq!(w.uncertified_fallbacks(), 1);
            assert_eq!(
                span(&w, doc, &y).block,
                block(BreakReason::WholeDocumentWrite, "agent")
            );
        }
        assert_eq!(head_text(&w, doc), "pYq\n\naZaZ");
    }
}
