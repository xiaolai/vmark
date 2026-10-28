//! `decide` refuses span geometry that splits a UTF-16 surrogate pair as a
//! writer invariant, before any early `FoundBase` / `Conflicted` answer.

use super::{decide, RevertDecision};
use crate::agent_journal::ids::HunkId;
use crate::agent_journal::review::{MappedSpan, Range};

/// "a🙂b": units a, high, low, b — offset 2 splits the emoji.
const TEXT: &str = "a\u{1F642}b";

fn span(start: u64, end: u64, growing: bool) -> MappedSpan {
    MappedSpan {
        hunk_id: HunkId("h".into()),
        range: Range { start, end },
        edited_since: false,
        growing,
        block: None,
        last_certified: None,
    }
}

#[test]
fn a_normal_span_ending_inside_a_pair_is_an_invariant_not_a_conflict() {
    let got = decide(&span(0, 2, false), "x", "zz", TEXT);
    assert!(got.is_err(), "got {got:?}");
}

#[test]
fn an_empty_span_inside_a_pair_is_an_invariant_not_a_found_base() {
    for growing in [false, true] {
        let got = decide(&span(2, 2, growing), "", "", TEXT);
        assert!(got.is_err(), "growing {growing}: got {got:?}");
    }
}

#[test]
fn an_inverted_span_inside_a_pair_is_an_invariant() {
    let got = decide(&span(3, 2, false), "x", "y", TEXT);
    assert!(got.is_err(), "got {got:?}");
}

#[test]
fn spans_on_pair_boundaries_still_decide() {
    assert_eq!(
        decide(&span(1, 3, false), "\u{1F642}", "x", TEXT),
        Ok(RevertDecision::FoundBase)
    );
    assert_eq!(
        decide(&span(3, 1, false), "x", "y", TEXT),
        Ok(RevertDecision::Conflicted)
    );
    match decide(&span(1, 3, false), "x", "\u{1F642}", TEXT) {
        Ok(RevertDecision::Apply { postimage, .. }) => assert_eq!(postimage, "axb"),
        other => panic!("expected apply, got {other:?}"),
    }
    match decide(&span(3, 3, true), "\u{4E2D}", "", TEXT) {
        Ok(RevertDecision::Apply { postimage, .. }) => {
            assert_eq!(postimage, "a\u{1F642}\u{4E2D}b")
        }
        other => panic!("expected apply, got {other:?}"),
    }
}

#[test]
fn an_offset_past_the_text_is_an_invariant() {
    assert!(decide(&span(0, u64::MAX, false), "", "", TEXT).is_err());
    assert!(decide(&span(u64::MAX, u64::MAX, true), "", "", TEXT).is_err());
}
