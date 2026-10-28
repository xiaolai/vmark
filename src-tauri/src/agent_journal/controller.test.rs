// WI-AL1.3 — the command side of document.write: string ids and JSON payloads from the webview, refusals with their journalCode (JOURNAL_BUSY, INVALID_TEXT), commit failure answering durable false and the degraded queue drained in the background without a restart, a failed aborted append keeping its reservation until the drainer retries it
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::controller::Controller;
use super::degraded_drain::{Backoff, DrainScheduler};
use super::doc_registry::DocRegistry;
use super::service::AgentJournalState;
use super::test_support::*;
use crate::command_error::ErrorCode;

fn controller() -> (
    tempfile::TempDir,
    Controller,
    Arc<crate::agent_journal::faults::Faults>,
) {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(Arc::new(w), Arc::default(), Arc::new(drains));
    (dir, c, faults)
}

fn prepare_payload(key: &str, parent: Option<&str>, preimage: &str) -> String {
    serde_json::json!({
        "docKey": key,
        "parent": parent,
        "preimage": preimage,
        "actor": agent(),
        "tool": "document.write",
    })
    .to_string()
}

fn journal_code(e: &crate::command_error::CommandError) -> String {
    e.detail().expect("detail")["journalCode"]
        .as_str()
        .expect("journalCode")
        .to_owned()
}

/// Wait until `f` holds; the drainer runs on its own thread.
fn eventually(mut f: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !f() {
        assert!(Instant::now() < deadline, "condition never held");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn prepare_commit_round_trips_through_wire_strings() {
    let (_dir, c, _) = controller();
    let p = c.prepare(&prepare_payload("path:/a.md", None, "")).unwrap();
    let wire = serde_json::to_value(p).unwrap();
    assert!(wire["generation"].is_string(), "R15: decimal string");
    let txn = wire["txn"].as_str().unwrap();
    let out = c.commit(txn, r#"{"postimage":"hello"}"#).unwrap();
    assert!(out.applied && out.durable);
    let wire = serde_json::to_value(out).unwrap();
    let parent = wire["revision"].as_str().unwrap();
    // The window's next write states the revision it last saw.
    let next = c.prepare(&prepare_payload("path:/a.md", Some(parent), "hello"));
    assert!(next.is_ok(), "{next:?}");
}

#[test]
fn a_second_prepare_on_a_held_document_is_a_conflict_with_journal_busy() {
    let (_dir, c, _) = controller();
    c.prepare(&prepare_payload("k", None, "")).unwrap();
    let err = c.prepare(&prepare_payload("k", None, "")).unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(journal_code(&err), "JOURNAL_BUSY");
    assert!(
        !err.code().is_retryable(),
        "a conflict is not blindly retried"
    );
}

#[test]
fn a_lone_surrogate_escaped_by_json_stringify_is_invalid_text() {
    let (_dir, c, _) = controller();
    // What JSON.stringify emits for a JS string holding an unpaired surrogate.
    let payload = prepare_payload("k", None, "PLACEHOLDER").replace("PLACEHOLDER", r"\ud800");
    let err = c.prepare(&payload).unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(journal_code(&err), "INVALID_TEXT");
}

#[test]
fn a_failed_commit_append_is_not_durable_and_drains_without_a_restart() {
    let (_dir, c, faults) = controller();
    let p = c.prepare(&prepare_payload("k", None, "")).unwrap();
    faults.fail_next_appends(3);
    let out = c
        .commit(&p.txn.to_string(), r#"{"postimage":"agent"}"#)
        .unwrap();
    assert!(out.applied && !out.durable);
    // The drainer started by the commit lands the record in the background.
    eventually(|| {
        c.prepare(&prepare_payload(
            "k",
            Some(&out.revision.to_string()),
            "agent",
        ))
        .is_ok()
    });
}

#[test]
fn a_failed_aborted_append_keeps_the_document_reserved_until_the_drainer_lands_it() {
    let (_dir, c, faults) = controller();
    let p = c.prepare(&prepare_payload("k", None, "")).unwrap();
    faults.fail_next_appends(5);
    let out = c.abort(&p.txn.to_string(), "composing").unwrap();
    assert!(!out.durable);
    eventually(|| match c.prepare(&prepare_payload("k", None, "")) {
        Ok(_) => true,
        Err(e) => {
            assert_eq!(journal_code(&e), "JOURNAL_DEGRADED", "refused while queued");
            false
        }
    });
}

#[test]
fn malformed_ids_and_reasons_are_invalid_input() {
    let (_dir, c, _) = controller();
    let p = c.prepare(&prepare_payload("k", None, "")).unwrap();
    for bad in ["", "not-a-uuid", "../../etc"] {
        let err = c.commit(bad, r#"{"postimage":"x"}"#).unwrap_err();
        assert_eq!(err.code(), ErrorCode::InvalidInput, "{bad}");
        assert_eq!(journal_code(&err), "INVALID_REQUEST");
    }
    let err = c.abort(&p.txn.to_string(), "because").unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(c.abort(&p.txn.to_string(), "closed").unwrap().durable);
}

#[test]
fn no_controller_exists_before_the_journal_has_started() {
    let state = AgentJournalState::default();
    assert!(state.controller().is_none());
    let _ = DocRegistry::default();
}
