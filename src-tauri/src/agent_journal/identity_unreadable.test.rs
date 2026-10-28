//! An identity index that opens but cannot be read (a corrupt line), or
//! cannot be opened at all (an I/O failure), disables identity exactly like
//! an incompatible one: a path the index already maps must never get a
//! fresh session identity, which would split its history. Every
//! identity-dependent operation refuses with the index's reason, nothing is
//! written to the index, and saving continues.

use std::fs;

use serde_json::json;

use crate::agent_journal::actor::Actor;
use crate::agent_journal::capture_tests::capture_payload;
use crate::agent_journal::doc_index::DOC_INDEX_FILE;
use crate::agent_journal::service::{start, AgentJournalState, JOURNAL_DIR};
use crate::agent_journal::service_identity::IdentityMode;
use crate::agent_journal::test_support::{agent, tmp};
use crate::command_error::CommandError;

fn ready(app_data: &std::path::Path) -> AgentJournalState {
    let state = AgentJournalState::default();
    state.finish(start(app_data));
    state
}

fn refused_with(e: &CommandError, reason: &str) {
    let text = format!("{} {:?}", e.message(), e.detail());
    assert!(text.contains("JOURNAL_CORRUPT"), "{text}");
    assert!(text.contains(reason), "{text}");
}

#[test]
fn a_corrupt_index_refuses_identity_instead_of_minting_a_fresh_one() {
    let (app_data, docs) = (tmp(), tmp());
    let a = docs.path().join("a.md");
    fs::write(&a, "x").unwrap();
    let key = format!("path:{}", a.display());
    let first = ready(app_data.path());
    first
        .controller()
        .unwrap()
        .docs
        .resolve(&key)
        .expect("mapped");
    drop(first);
    let index = app_data.path().join(JOURNAL_DIR).join(DOC_INDEX_FILE);
    let mut bytes = fs::read(&index).unwrap();
    bytes.extend_from_slice(b"not an index line\n");
    fs::write(&index, &bytes).unwrap();

    let state = ready(app_data.path());
    let status = state.status();
    assert_eq!(status.identity, IdentityMode::Disabled);
    let reason = status.identity_error.expect("the status says why");
    assert!(reason.contains("unreadable"), "{reason}");
    let c = state.controller().expect("the journal itself opened");
    let generation = c.writer.generation();

    let refused =
        |e: crate::agent_journal::errors::TxnError| crate::agent_journal::refusal::refusal(&e);
    refused_with(&refused(c.docs.resolve(&key).unwrap_err()), "unreadable");
    let bind = json!({ "from": key, "to": "tab:main/t9" }).to_string();
    refused_with(&state.bind_document(&bind).unwrap_err(), "unreadable");
    let find = json!({ "docKey": key }).to_string();
    refused_with(&state.find_document(&find).unwrap_err(), "unreadable");
    let capture = capture_payload(&key, "main/t1", None, "saved", &Actor::Human);
    refused_with(&c.capture(&capture).unwrap_err(), "unreadable");
    let prepare = json!({
        "docKey": key, "parent": null, "preimage": "x",
        "actor": agent(), "tool": "document.write",
    });
    refused_with(&c.prepare(&prepare.to_string()).unwrap_err(), "unreadable");

    assert_eq!(c.writer.generation(), generation, "no journal mutation");
    assert_eq!(fs::read(&index).unwrap(), bytes, "index untouched");
    crate::files::write::atomic_write_file_sync(&a, "saved anyway").expect("save");
    assert_eq!(fs::read_to_string(&a).unwrap(), "saved anyway");
}

#[cfg(unix)]
#[test]
fn an_index_that_cannot_open_disables_identity() {
    let app_data = tmp();
    // A directory where the index file belongs: opening it fails with I/O.
    fs::create_dir_all(app_data.path().join(JOURNAL_DIR).join(DOC_INDEX_FILE)).unwrap();
    let state = ready(app_data.path());
    let status = state.status();
    assert_eq!(status.identity, IdentityMode::Disabled);
    let reason = status.identity_error.expect("the status says why");
    assert!(reason.contains("I/O"), "{reason}");
    let c = state.controller().expect("the journal itself opened");
    let e = c.docs.resolve("tab:main/t1").unwrap_err();
    refused_with(&crate::agent_journal::refusal::refusal(&e), "I/O");
}
