//! WI-AL1.6 — document identity wired into the app's journal: the index
//! attaches at startup and survives a restart, Save As binds through the
//! state, a save capture records the file identity a later external rename
//! is checked against, and a bind payload is validated.

use std::fs;
use std::path::Path;

use super::actor::Actor;
use super::capture_tests::capture_payload;
use super::doc_index::DOC_INDEX_FILE;
use super::ids::DocId;
use super::service::{start, AgentJournalState, JOURNAL_DIR};
use super::test_support::tmp;

fn ready(app_data: &Path) -> AgentJournalState {
    let state = AgentJournalState::default();
    state.finish(start(app_data));
    state
}

fn doc(state: &AgentJournalState, key: &str) -> DocId {
    state
        .controller()
        .expect("ready")
        .docs
        .resolve(key)
        .expect("resolve")
}

fn bind(from: &str, to: &str) -> String {
    serde_json::json!({ "from": from, "to": to }).to_string()
}

#[test]
fn the_identity_index_attaches_at_startup_and_a_save_as_survives_a_restart() {
    let (app_data, docs) = (tmp(), tmp());
    let a = docs.path().join("a.md");
    fs::write(&a, "x").unwrap();
    let key = format!("path:{}", a.display());
    let state = ready(app_data.path());
    let untitled = doc(&state, "tab:main/t1");
    let moved = state.bind_document(&bind("tab:main/t1", &key));
    assert_eq!(
        moved.expect("bind"),
        untitled,
        "the bind replies the document"
    );
    assert!(state.status().identity_error.is_none());
    assert!(app_data
        .path()
        .join(JOURNAL_DIR)
        .join(DOC_INDEX_FILE)
        .exists());
    drop(state);
    assert_eq!(
        doc(&ready(app_data.path()), &key),
        untitled,
        "reopen after restart"
    );
}

#[test]
fn a_bind_payload_is_validated() {
    let state = AgentJournalState::default();
    for bad in [
        "",
        "{}",
        r#"{"from":"tab:a"}"#,
        r#"{"from":"tab:a","to":"tab:b","x":1}"#,
        r#"{"from":"","to":"tab:b"}"#,
    ] {
        assert!(state.bind_document(bad).is_err(), "{bad}");
    }
    state
        .bind_document(&bind("tab:w/1", "tab:w/2"))
        .expect("works before the journal is ready");
}

#[test]
fn a_save_capture_records_the_file_identity_an_external_rename_needs() {
    let (app_data, docs) = (tmp(), tmp());
    let a = docs.path().join("a.md");
    fs::write(&a, "x").unwrap();
    let key = format!("path:{}", a.display());
    let state = ready(app_data.path());
    let before = doc(&state, &key);
    let staged = docs.path().join("a.md.tmp");
    fs::write(&staged, "saved").unwrap();
    fs::rename(&staged, &a).unwrap();
    state
        .controller()
        .unwrap()
        .capture(&capture_payload(
            &key,
            "main/t1",
            None,
            "saved",
            &Actor::Human,
        ))
        .expect("capture");
    let b = docs.path().join("b.md");
    fs::rename(&a, &b).unwrap();
    assert_eq!(state.note_renames(&[a, b.clone()]), 1);
    assert_eq!(doc(&state, &format!("path:{}", b.display())), before);
}

#[test]
fn an_epoch_closed_after_a_rename_closes_the_document_it_was_armed_on() {
    let (app_data, docs) = (tmp(), tmp());
    let a = docs.path().join("a.md");
    fs::write(&a, "x").unwrap();
    let (old, new) = (
        format!("path:{}", a.display()),
        format!("path:{}", docs.path().join("b.md").display()),
    );
    let state = ready(app_data.path());
    let c = state.controller().unwrap();
    let armed = c
        .arm_epoch(&serde_json::json!({ "docKey": old }).to_string())
        .expect("arm");
    state.bind_document(&bind(&old, &new)).expect("bind");
    let close =
        serde_json::json!({ "docKey": old, "epoch": armed.epoch.to_string(), "doc": armed.doc });
    c.close_epoch(&close.to_string())
        .expect("closes the armed document, not a fresh one");
    assert_eq!(c.writer.epoch(armed.doc), None);
    assert_eq!(doc(&state, &new), armed.doc);
    let arm_with_doc = serde_json::json!({ "docKey": new, "doc": armed.doc });
    assert!(
        c.arm_epoch(&arm_with_doc.to_string()).is_err(),
        "arming names no document"
    );
}

#[test]
fn a_path_resolved_the_moment_the_journal_is_ready_gets_its_durable_document() {
    let (app_data, docs) = (tmp(), tmp());
    let a = docs.path().join("a.md");
    fs::write(&a, "x").unwrap();
    let key = format!("path:{}", a.display());
    let durable = doc(&ready(app_data.path()), &key);
    // Pad the index so attaching it takes a while: the outcome must not be
    // visible before the index is attached.
    let index = app_data.path().join(JOURNAL_DIR).join(DOC_INDEX_FILE);
    let text = fs::read_to_string(&index).unwrap();
    let mut lines = text.lines();
    let header = lines.next().expect("the header").to_owned() + "\n";
    let put = lines.next().expect("one put").to_owned() + "\n";
    fs::write(&index, header + &put.repeat(40_000)).unwrap();

    let state = AgentJournalState::default();
    let seen = std::thread::scope(|s| {
        let racer = s.spawn(|| loop {
            if let Some(c) = state.controller() {
                return c.docs.resolve(&key).expect("resolve");
            }
            std::hint::spin_loop();
        });
        state.finish(start(app_data.path()));
        racer.join().unwrap()
    });
    assert_eq!(seen, durable, "resolved before the identity index attached");
    assert_eq!(doc(&state, &key), durable);
}

fn bind_expecting(from: &str, to: &str, expected: DocId) -> String {
    serde_json::json!({ "from": from, "to": to, "expectedDoc": expected }).to_string()
}

/// A bind states the document it expects at its source (a compare-and-set):
/// replayed after the source path was reused and the destination rebound,
/// it is refused instead of carrying the reused path's document over the
/// rebound destination.
#[test]
fn a_replayed_bind_whose_source_was_reused_is_refused_not_moved() {
    let (app_data, docs) = (tmp(), tmp());
    let path = |n: &str| format!("path:{}", docs.path().join(n).display());
    let (a, b, x) = (path("a.md"), path("b.md"), path("x.md"));
    for n in ["a.md", "x.md"] {
        fs::write(docs.path().join(n), n).unwrap();
    }
    let state = ready(app_data.path());
    let first = doc(&state, &a);
    state
        .bind_document(&bind_expecting(&a, &b, first))
        .expect("A to B");
    assert_eq!(doc(&state, &b), first);
    let reused = doc(&state, &a);
    assert_ne!(reused, first, "A is a new document");
    let rebound = doc(&state, &x);
    state
        .bind_document(&bind_expecting(&x, &b, rebound))
        .expect("X to B");
    assert!(
        state.bind_document(&bind_expecting(&a, &b, first)).is_err(),
        "A no longer carries the document the bind moved"
    );
    assert_eq!(doc(&state, &b), rebound, "B keeps its document");
    assert_eq!(doc(&state, &a), reused, "A keeps its document");
}

/// A repeat of the last bind is checked against its expectation too: replayed
/// after another key bound over the destination, it is refused rather than
/// reporting the other document as the one the bind moved. A plain retry of
/// a landed bind (its acknowledgement lost) still succeeds.
#[test]
fn a_repeated_bind_whose_destination_was_rebound_is_refused() {
    let (app_data, docs) = (tmp(), tmp());
    let path = |n: &str| format!("path:{}", docs.path().join(n).display());
    let (a, b, c) = (path("a.md"), path("b.md"), path("c.md"));
    for n in ["a.md", "c.md"] {
        fs::write(docs.path().join(n), n).unwrap();
    }
    let state = ready(app_data.path());
    let moved = doc(&state, &a);
    state
        .bind_document(&bind_expecting(&a, &b, moved))
        .expect("A to B");
    state
        .bind_document(&bind_expecting(&a, &b, moved))
        .expect("a retry of the landed bind is a no-op");
    let other = doc(&state, &c);
    state
        .bind_document(&bind_expecting(&c, &b, other))
        .expect("C to B");
    assert!(
        state.bind_document(&bind_expecting(&a, &b, moved)).is_err(),
        "B no longer carries the document A's bind moved"
    );
    assert_eq!(doc(&state, &b), other, "B keeps its document");
}

fn bind_expecting_none(from: &str, to: &str) -> String {
    serde_json::json!({ "from": from, "to": to, "expectedDoc": null }).to_string()
}

/// `expectedDoc: null` states the source carries no document: a source
/// that holds one is refused with nothing changed.
#[test]
fn a_bind_expecting_an_empty_source_refuses_a_source_that_holds_one() {
    let (app_data, docs) = (tmp(), tmp());
    let path = |n: &str| format!("path:{}", docs.path().join(n).display());
    let (a, b) = (path("a.md"), path("b.md"));
    fs::write(docs.path().join("a.md"), "a").unwrap();
    let state = ready(app_data.path());
    let held = doc(&state, &a);
    assert!(state.bind_document(&bind_expecting_none(&a, &b)).is_err());
    assert_eq!(doc(&state, &a), held, "A keeps its document");
    let docs = &state.controller().expect("ready").docs;
    assert_eq!(docs.find(&b).expect("find"), None, "B was not bound");
}

/// An empty source binds a fresh document; a retry of that bind is a
/// no-op, and a replay after another key bound over the destination is
/// refused like any other repeat whose destination moved on.
#[test]
fn a_bind_expecting_an_empty_source_repeats_only_onto_its_own_document() {
    let (app_data, docs) = (tmp(), tmp());
    let path = |n: &str| format!("path:{}", docs.path().join(n).display());
    let (a, b, c) = (path("a.md"), path("b.md"), path("c.md"));
    fs::write(docs.path().join("c.md"), "c").unwrap();
    let state = ready(app_data.path());
    state
        .bind_document(&bind_expecting_none(&a, &b))
        .expect("an empty A binds");
    let minted = doc(&state, &b);
    state
        .bind_document(&bind_expecting_none(&a, &b))
        .expect("a retry is a no-op");
    assert_eq!(doc(&state, &b), minted);
    let other = doc(&state, &c);
    state
        .bind_document(&bind_expecting(&c, &b, other))
        .expect("C to B");
    assert!(state.bind_document(&bind_expecting_none(&a, &b)).is_err());
    assert_eq!(doc(&state, &b), other, "B keeps its document");
}

/// `findDocument` reads a key's document without minting one.
#[test]
fn finding_a_document_never_mints_one() {
    let (app_data, docs) = (tmp(), tmp());
    let a = format!("path:{}", docs.path().join("a.md").display());
    let state = ready(app_data.path());
    let find = |key: &str| state.find_document(&serde_json::json!({ "docKey": key }).to_string());
    assert_eq!(find(&a).expect("find"), None);
    assert_eq!(
        find(&a).expect("find again"),
        None,
        "the read minted nothing"
    );
    let held = doc(&state, &a);
    assert_eq!(find(&a).expect("find"), Some(held));
    assert!(state.find_document("{}").is_err(), "docKey is required");
    assert!(find("").is_err(), "an empty key is refused");
}
