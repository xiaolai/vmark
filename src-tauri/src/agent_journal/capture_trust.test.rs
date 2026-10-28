// WI-AL2.1d — the capture binding {view, session, seq}: the writer refuses a save whose capture seq does not extend the last one it recorded for that session, with nothing appended; sessions are independent and keyed by session alone; a save refused before its append leaves the seq unrecorded; a queued save records it; malformed capture ids are refused at decode
use serde_json::{json, Value};

use super::actor::Actor;
use super::capture::JournaledFlag;
use super::capture_tests::{agent_write, journal_code, rev, setup};
use super::controller::Controller;
use super::ids::RevisionId;
use super::writer::Writer;

/// A save of `post` on `k` built on `parent`, carrying `capture`.
fn bound_save(parent: Option<RevisionId>, post: &str, capture: Value) -> String {
    json!({
        "docKey": "k",
        "window": "main/t1",
        "observedParent": rev(parent.expect("a parent revision")),
        "postimage": post,
        "initiator": Actor::Human,
        "capture": capture,
    })
    .to_string()
}

fn id(view: &str, session: &str, seq: &str) -> Value {
    json!({ "view": view, "session": session, "seq": seq })
}

/// Save `post` on the head with `capture`; the head is re-read each time.
fn save(w: &Writer, c: &Controller, post: &str, capture: Value) -> Result<JournaledFlag, String> {
    let head = w.head(w.snapshot().state.docs.keys().copied().next().expect("doc"));
    c.capture(&bound_save(head, post, capture))
        .map(|r| r.journaled)
        .map_err(|e| journal_code(&e))
}

#[test]
fn a_capture_seq_regression_is_refused_with_nothing_appended() {
    let (_dir, w, c, _faults) = setup();
    agent_write(&c, "k", None, "", "base");
    assert!(save(&w, &c, "one", id("source", "s-1", "2")).is_ok());
    let len = w.journal_len();
    let generation = w.snapshot().generation;

    // The same seq again does not extend it, nor does an earlier one.
    for seq in ["2", "1", "0"] {
        let refused = save(&w, &c, "replayed", id("source", "s-1", seq));
        assert!(refused.is_err(), "seq {seq} after 2 must be refused");
        assert_eq!(refused.unwrap_err(), "INVALID_REQUEST");
        assert_eq!(w.journal_len(), len, "seq {seq}: nothing appended");
        assert_eq!(w.snapshot().generation, generation);
    }

    // The next seq extends it and lands.
    assert!(save(&w, &c, "two", id("source", "s-1", "3")).is_ok());
    assert!(w.journal_len() > len);
}

#[test]
fn sessions_are_independent_and_the_view_does_not_split_one() {
    let (_dir, w, c, _faults) = setup();
    agent_write(&c, "k", None, "", "base");
    assert!(save(&w, &c, "a5", id("source", "s-a", "5")).is_ok());
    assert!(
        save(&w, &c, "b0", id("source", "s-b", "0")).is_ok(),
        "another session starts fresh"
    );
    let len = w.journal_len();
    assert!(
        save(&w, &c, "a4", id("wysiwyg", "s-a", "4")).is_err(),
        "the seq orders the whole session, whichever view froze it"
    );
    assert_eq!(w.journal_len(), len);
    assert!(save(&w, &c, "a6", id("wysiwyg", "s-a", "6")).is_ok());
}

#[test]
fn a_save_refused_before_its_append_leaves_its_seq_unrecorded() {
    let (_dir, w, c, _faults) = setup();
    agent_write(&c, "k", None, "", "base");
    let unknown_parent = Some(RevisionId::new());
    let refused = c.capture(&bound_save(unknown_parent, "x", id("source", "s-1", "1")));
    assert!(refused.is_err());
    assert!(
        save(&w, &c, "x", id("source", "s-1", "1")).is_ok(),
        "the same capture may be resent"
    );
}

#[test]
fn a_queued_save_records_its_seq() {
    let (_dir, w, c, faults) = setup();
    agent_write(&c, "k", None, "", "base");
    faults.fail_next_appends(1);
    assert_eq!(
        save(&w, &c, "q", id("source", "s-1", "7")),
        Ok(JournaledFlag::No)
    );
    let refused = save(&w, &c, "q again", id("source", "s-1", "7"));
    assert_eq!(refused, Err("INVALID_REQUEST".to_owned()));
}

#[test]
fn malformed_capture_ids_are_refused_at_decode() {
    let (_dir, w, c, _faults) = setup();
    agent_write(&c, "k", None, "", "base");
    let len = w.journal_len();
    let long = "s".repeat(129);
    let bad = [
        json!({ "view": "source", "session": "s", "seq": 1 }),
        id("source", "s", "01"),
        id("source", "s", "-1"),
        id("source", "", "1"),
        id("", "s", "1"),
        id("source", &long, "1"),
        json!({ "view": "source", "session": "s", "seq": "1", "extra": true }),
        json!({ "session": "s", "seq": "1" }),
    ];
    for capture in bad {
        let out = save(&w, &c, "x", capture.clone());
        assert!(out.is_err(), "{capture} must be refused");
    }
    assert_eq!(w.journal_len(), len, "nothing appended");
    assert!(save(
        &w,
        &c,
        "x",
        id("source", &"s".repeat(128), "18446744073709551615")
    )
    .is_ok());
    assert!(
        save(
            &w,
            &c,
            "y",
            id("source", &"s".repeat(128), "18446744073709551615")
        )
        .is_err(),
        "nothing extends u64::MAX"
    );
}

/// A save of `post` claiming `head`, carrying `capture`.
fn claimed_save(head: RevisionId, post: &str, capture: Value) -> String {
    let mut v: Value = serde_json::from_str(&bound_save(Some(head), post, capture)).unwrap();
    v["claimsRevision"] = serde_json::to_value(head).unwrap();
    v.to_string()
}

#[test]
fn an_elided_save_records_its_seq_so_an_older_capture_is_refused() {
    let (_dir, w, c, _faults) = setup();
    let head = agent_write(&c, "k", None, "", "base");
    let len = w.journal_len();
    let elided = c
        .capture(&claimed_save(head, "base", id("source", "s-1", "2")))
        .unwrap();
    assert_eq!(elided.observation, None, "the claim is verified and elided");
    assert_eq!(w.journal_len(), len);

    // The delayed earlier capture would journal stale text over it.
    assert_eq!(
        save(&w, &c, "stale", id("source", "s-1", "1")),
        Err("INVALID_REQUEST".to_owned())
    );
    // An elided save is checked too: its seq must extend the session's.
    let replayed = c.capture(&claimed_save(head, "base", id("source", "s-1", "2")));
    assert_eq!(
        replayed.map_err(|e| journal_code(&e)).err().as_deref(),
        Some("INVALID_REQUEST")
    );
    assert_eq!(w.journal_len(), len, "nothing appended");
    assert!(save(&w, &c, "next", id("source", "s-1", "3")).is_ok());
}
