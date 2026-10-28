// WI-AL2.2c — the head read a tab makes before its first controlled write and after a pending save (R32): a key with no document reads null (genesis) and mints none; a document past genesis reads its settled head, the one the expectedHead CAS compares against; a malformed payload is INVALID_REQUEST; a journal that is not running refuses rather than answering genesis
//! R32. Drives `AgentJournalState::head` with the payload the webview sends.

use crate::agent_journal::actor::Actor;
use crate::agent_journal::capture_tests::capture_payload;
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::service::{start, AgentJournalState};
use crate::agent_journal::test_support::tmp;

fn ready(app_data: &std::path::Path) -> AgentJournalState {
    let state = AgentJournalState::default();
    state.finish(start(app_data));
    state
}

fn read(state: &AgentJournalState, key: &str) -> Option<RevisionId> {
    state
        .head(&serde_json::json!({ "docKey": key }).to_string())
        .expect("head")
}

#[test]
fn a_key_with_no_document_reads_genesis_and_mints_none() {
    let app_data = tmp();
    let state = ready(app_data.path());
    assert_eq!(read(&state, "tab:main/t1"), None);
    let found = state.find_document(&serde_json::json!({ "docKey": "tab:main/t1" }).to_string());
    assert_eq!(found.expect("find"), None, "the read minted no document");
}

#[test]
fn a_document_past_genesis_reads_its_settled_head() {
    let app_data = tmp();
    let state = ready(app_data.path());
    let c = state.controller().expect("ready");
    let key = "tab:main/t1";
    c.capture(&capture_payload(
        key,
        "main/t1",
        None,
        "saved\n",
        &Actor::Human,
    ))
    .expect("capture");
    let doc = c.docs.resolve(key).unwrap();
    let head = c.writer.head(doc);
    assert!(head.is_some(), "the save settled");
    assert_eq!(read(&state, key), head);
}

#[test]
fn a_malformed_payload_is_an_invalid_request() {
    let app_data = tmp();
    let state = ready(app_data.path());
    let e = state.head("{\"doc\":\"x\"}").unwrap_err();
    assert!(
        format!("{:?}", e.detail()).contains("INVALID_REQUEST"),
        "{e:?}"
    );
}

#[test]
fn a_journal_that_is_not_running_refuses_rather_than_answering_genesis() {
    let state = AgentJournalState::default();
    let e = state
        .head(&serde_json::json!({ "docKey": "tab:main/t1" }).to_string())
        .unwrap_err();
    assert!(format!("{:?}", e.detail()).contains("JOURNAL_"), "{e:?}");
}
