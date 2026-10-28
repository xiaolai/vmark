//! An identity index this build cannot read stops identity, not saving:
//! every identity-dependent journal operation refuses with the index's
//! reason, the journal gains nothing, the index stays byte-for-byte as it
//! was, and the save path still writes the file. The status tells
//! disabled identity apart from a durable one and from the session-only
//! identity held until the index attaches.

use std::fs;
use std::path::Path;

use serde_json::json;

use crate::agent_journal::actor::Actor;
use crate::agent_journal::capture_tests::capture_payload;
use crate::agent_journal::doc_index::DOC_INDEX_FILE;
use crate::agent_journal::service::{start, AgentJournalState, JOURNAL_DIR};
use crate::agent_journal::service_identity::IdentityMode;
use crate::agent_journal::test_support::{agent, tmp};

const INCOMPATIBLE: &[u8] = b"{\"op\":\"header\",\"format\":99,\"keyPolicy\":\"later\"}\n";

fn refused_with_reason(e: &crate::command_error::CommandError) {
    let text = format!("{} {:?}", e.message(), e.detail());
    assert!(text.contains("JOURNAL_CORRUPT"), "{text}");
    assert!(
        text.contains("Journal recording is disabled; the index has not been modified"),
        "{text}"
    );
}

#[test]
fn a_mismatched_index_disables_identity_and_leaves_everything_unchanged() {
    let (app_data, docs) = (tmp(), tmp());
    let journal = app_data.path().join(JOURNAL_DIR);
    fs::create_dir_all(&journal).unwrap();
    let index = journal.join(DOC_INDEX_FILE);
    fs::write(&index, INCOMPATIBLE).unwrap();
    let a = docs.path().join("a.md");
    fs::write(&a, "x").unwrap();
    let key = format!("path:{}", a.display());

    let state = AgentJournalState::default();
    state.finish(start(app_data.path()));
    let c = state.controller().expect("the journal itself opened");
    let generation = c.writer.generation();

    assert_eq!(state.status().identity, IdentityMode::Disabled);
    let reason = state.status().identity_error.expect("status says why");
    assert!(
        reason.contains("version 99/later is incompatible"),
        "{reason}"
    );

    refused_with_reason(
        &c.docs
            .resolve(&key)
            .map_err(|e| crate::agent_journal::refusal::refusal(&e))
            .unwrap_err(),
    );
    let bind = json!({ "from": "tab:main/t1", "to": key }).to_string();
    refused_with_reason(&state.bind_document(&bind).unwrap_err());
    let find = json!({ "docKey": key }).to_string();
    refused_with_reason(&state.find_document(&find).unwrap_err());
    let capture = capture_payload(&key, "main/t1", None, "saved", &Actor::Human);
    refused_with_reason(&c.capture(&capture).unwrap_err());
    let prepare = json!({
        "docKey": key, "parent": null, "preimage": "x",
        "actor": agent(), "tool": "document.write",
    });
    refused_with_reason(&c.prepare(&prepare.to_string()).unwrap_err());
    let arm = json!({ "docKey": "tab:main/t2" }).to_string();
    refused_with_reason(&c.arm_epoch(&arm).unwrap_err());
    assert_eq!(state.note_renames(std::slice::from_ref(&a)), 0);

    assert_eq!(c.writer.generation(), generation, "no journal mutation");
    assert_eq!(fs::read(&index).unwrap(), INCOMPATIBLE, "index untouched");
    // Ordinary saving does not go through the journal's identity.
    crate::files::write::atomic_write_file_sync(&a, "saved anyway").expect("save");
    assert_eq!(fs::read_to_string(&a).unwrap(), "saved anyway");
    drop(state);
    assert_eq!(fs::read(Path::new(&index)).unwrap(), INCOMPATIBLE);
}

fn started_with_index(index_bytes: Option<&[u8]>) -> (tempfile::TempDir, AgentJournalState) {
    let app_data = tmp();
    if let Some(bytes) = index_bytes {
        let journal = app_data.path().join(JOURNAL_DIR);
        fs::create_dir_all(&journal).unwrap();
        fs::write(journal.join(DOC_INDEX_FILE), bytes).unwrap();
    }
    let state = AgentJournalState::default();
    state.finish(start(app_data.path()));
    (app_data, state)
}

#[test]
fn the_status_tells_disabled_and_durable_identity_apart() {
    let (durable_dir, durable) = started_with_index(None);
    let status = durable.status();
    assert_eq!(status.identity, IdentityMode::Durable);
    assert!(status.identity_error.is_none());

    // A valid header, then an unreadable line: corrupt, not incompatible,
    // and still disabled, with its own reason.
    let index =
        fs::read_to_string(durable_dir.path().join(JOURNAL_DIR).join(DOC_INDEX_FILE)).unwrap();
    let header = index.lines().next().expect("the header");
    let corrupt = format!("{header}\nnot an index line\n");
    let (_s, unreadable) = started_with_index(Some(corrupt.as_bytes()));
    let status = unreadable.status();
    assert_eq!(status.identity, IdentityMode::Disabled);
    let reason = status.identity_error.expect("the status says why");
    assert!(reason.contains("unreadable"), "{reason}");

    let (_x, disabled) = started_with_index(Some(INCOMPATIBLE));
    let reason = disabled
        .status()
        .identity_error
        .expect("the status says why");
    assert!(reason.contains("incompatible"), "{reason}");
}

#[test]
fn identity_is_session_only_until_the_index_attaches_and_serializes_camel_case() {
    let state = AgentJournalState::default();
    assert_eq!(state.status().identity, IdentityMode::SessionOnly);
    let wire = serde_json::to_value(state.status()).unwrap();
    assert_eq!(wire["identity"], "sessionOnly");
    let (_x, disabled) = started_with_index(Some(INCOMPATIBLE));
    assert_eq!(
        serde_json::to_value(disabled.status()).unwrap()["identity"],
        "disabled"
    );
    let (_d, durable) = started_with_index(None);
    assert_eq!(
        serde_json::to_value(durable.status()).unwrap()["identity"],
        "durable"
    );
}
