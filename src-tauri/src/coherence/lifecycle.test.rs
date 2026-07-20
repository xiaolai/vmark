// Document lifecycle — the projection that stops the layer interrupting about
// FINISHED documents. Exists because M2 measured 0 relevant / 5 noise, with the
// same cause every time: the downstream was already done.

use super::*;
use crate::coherence::types::WriterId;
use serde_json::json;

fn writer() -> WriterId {
    WriterId(uuid::Uuid::from_u128(1))
}

fn obj(n: u128) -> ObjectId {
    ObjectId(Uuid::from_u128(n))
}

fn transition(n: u128, state: &str, time: &str) -> Envelope {
    let mut e = Envelope::create(
        "object-lifecycle",
        writer(),
        json!({ "object": Uuid::from_u128(n).to_string(), "state": state, "reason": "" }),
    );
    e.time = time.to_string();
    e
}

#[test]
fn an_object_with_no_transition_is_live() {
    // `live` is the default and is never stored — only transitions are recorded,
    // so an untouched workspace projects no lifecycle state at all.
    let set = LifecycleSet::from_entries(&[]);
    assert!(!set.is_frozen(&obj(1)));
    assert_eq!(set.frozen_count(), 0);
}

#[test]
fn a_frozen_transition_is_projected() {
    let set = LifecycleSet::from_entries(&[transition(1, "frozen", "2026-07-20T10:00:00Z")]);
    assert!(set.is_frozen(&obj(1)));
    assert_eq!(set.frozen_count(), 1);
}

#[test]
fn freezing_is_reversible_and_the_latest_transition_wins() {
    // Un-freezing must restore flagging: a revived document CAN go stale again.
    // Both entries stay in history — this is append-only, not a mutable flag.
    let set = LifecycleSet::from_entries(&[
        transition(1, "frozen", "2026-07-20T10:00:00Z"),
        transition(1, "live", "2026-07-20T12:00:00Z"),
    ]);
    assert!(!set.is_frozen(&obj(1)), "the later `live` wins");
    assert_eq!(set.frozen_count(), 0);
}

#[test]
fn an_unknown_state_is_ignored_rather_than_trusted() {
    // A malformed or future state must not be coerced into `frozen` — silently
    // suppressing flags is the most damaging possible failure here.
    let mut e = Envelope::create(
        "object-lifecycle",
        writer(),
        json!({ "object": Uuid::from_u128(1).to_string(), "state": "archived" }),
    );
    e.time = "2026-07-20T10:00:00Z".into();
    let set = LifecycleSet::from_entries(&[e]);
    assert!(!set.is_frozen(&obj(1)));
}

#[test]
fn a_malformed_object_id_is_skipped() {
    let mut e = Envelope::create(
        "object-lifecycle",
        writer(),
        json!({ "object": "not-a-uuid", "state": "frozen" }),
    );
    e.time = "2026-07-20T10:00:00Z".into();
    assert_eq!(LifecycleSet::from_entries(&[e]).frozen_count(), 0);
}

#[test]
fn other_entry_kinds_do_not_affect_lifecycle() {
    let mut e = Envelope::create("diagnostic", writer(), json!({ "code": "x" }));
    e.time = "2026-07-20T10:00:00Z".into();
    assert_eq!(LifecycleSet::from_entries(&[e]).frozen_count(), 0);
}

#[test]
fn an_unknown_state_is_refused_at_the_write_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer()).unwrap();
    let err = set_lifecycle(&mut kernel, &obj(1), "archived", "").unwrap_err();
    assert!(err.contains("unknown lifecycle state"), "got: {err}");
}

#[test]
fn freezing_an_untracked_object_is_refused() {
    // Freezing something the layer has never seen would put an unreachable row
    // in the projection.
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer()).unwrap();
    let err = set_lifecycle(&mut kernel, &obj(1), "frozen", "done").unwrap_err();
    assert!(err.contains("not a tracked object"), "got: {err}");
}

#[test]
fn an_oversized_reason_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer()).unwrap();
    let big = "x".repeat(3 * 1024);
    let err = set_lifecycle(&mut kernel, &obj(1), "frozen", &big).unwrap_err();
    assert!(err.contains("over the"), "got: {err}");
}
