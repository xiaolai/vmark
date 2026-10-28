// WI-AL2.2f — a framed payload is text-checked before its frame is parsed: a lone surrogate anywhere in a framed prepare, abandon, restore, revert, comment create or comment reply is INVALID_TEXT, not INVALID_REQUEST, with nothing appended; a well-formed surrogate pair, literal or escaped, still prepares and passes every other entry's text check
//! R68, through every entry that reads a `Frame`: `Controller::prepare_framed`,
//! `abandon`, `restore_prepare_framed`, `revert_prepare_framed` and both
//! comment handles' `create` and `reply`.

use serde_json::json;

use crate::agent_journal::admission::request_support::*;
use crate::command_error::CommandError;

const MARK: &str = "SURROGATE";

/// `r.p` with its preimage replaced by the raw JSON escape `escape`.
fn escaped(r: &Rig, page: &Page, escape: &str) -> String {
    r.p_head(page, MARK).replace(MARK, escape)
}

#[test]
fn a_lone_surrogate_in_a_framed_prepare_is_invalid_text_with_nothing_appended() {
    let r = rig();
    let a = r.page("doc-a", 1);
    for lone in [r"\ud800", r"\udc00", r"x\ud800y"] {
        let before = r.journal_len();
        let e = r.prepare(&a, &escaped(&r, &a, lone)).expect_err(lone);
        assert_eq!(journal_code(&e), "INVALID_TEXT", "{lone}");
        assert_eq!(r.journal_len(), before, "{lone}: nothing appended");
    }
}

#[test]
fn a_lone_surrogate_in_a_framed_abandon_is_invalid_text() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let e = r
        .abandon(&a.label, &escaped(&r, &a, r"\ud800"))
        .expect_err("lone surrogate");
    assert_eq!(journal_code(&e), "INVALID_TEXT");
}

#[test]
fn a_surrogate_pair_in_a_framed_prepare_still_prepares() {
    let r = rig();
    let a = r.page("doc-a", 1);
    r.prepare(&a, &escaped(&r, &a, r"😀"))
        .expect("a well-formed pair is text");
    let r = rig();
    let a = r.page("doc-a", 1);
    r.prepare(&a, &escaped(&r, &a, r"\ud83d\ude00"))
        .expect("an escaped well-formed pair is text");
}

/// One framed entry, called with the payload under test.
type Entry<'a> = Box<dyn Fn() -> Result<(), CommandError> + 'a>;

#[test]
fn a_lone_surrogate_in_every_other_framed_entry_is_invalid_text() {
    for lone in [r"\ud800", r"\udc00"] {
        every_other_entry(lone, |name, out| {
            let e = out.expect_err(name);
            assert_eq!(journal_code(&e), "INVALID_TEXT", "{name} {lone}");
        });
    }
}

#[test]
fn a_surrogate_pair_in_every_other_framed_entry_passes_the_text_check() {
    for pair in [r"😀", r"\ud83d\ude00"] {
        every_other_entry(pair, |name, out| {
            if let Err(e) = out {
                assert_ne!(journal_code(&e), "INVALID_TEXT", "{name} {pair}");
            }
        });
    }
}

/// Call every framed entry but prepare and abandon with a frame whose
/// `docKey` is `text`, handing each outcome to `check`; none appends.
fn every_other_entry(text: &str, check: impl Fn(&str, Result<(), CommandError>)) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let lone = r.frame(&a, json!({ "docKey": MARK })).replace(MARK, text);
    let (user, agent) = (r.c.comments_user(), r.c.comments_agent());
    let entries: [(&str, Entry<'_>); 6] = [
        (
            "restore",
            Box::new(|| {
                r.c.restore_prepare_framed(&r.pages, &a.label, &lone)
                    .map(drop)
            }),
        ),
        (
            "revert",
            Box::new(|| {
                r.c.revert_prepare_framed(&r.pages, &a.label, &lone)
                    .map(drop)
            }),
        ),
        (
            "user create",
            Box::new(|| user.create(&r.pages, &a.label, &lone).map(drop)),
        ),
        (
            "user reply",
            Box::new(|| user.reply(&r.pages, &a.label, &lone).map(drop)),
        ),
        (
            "agent create",
            Box::new(|| agent.create(&r.pages, &a.label, &lone).map(drop)),
        ),
        (
            "agent reply",
            Box::new(|| agent.reply(&r.pages, &a.label, &lone).map(drop)),
        ),
    ];
    for (name, entry) in entries {
        let before = r.journal_len();
        check(name, entry());
        assert_eq!(r.journal_len(), before, "{name}: nothing appended");
    }
}
