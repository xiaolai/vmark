//! Tests for `tab_transfer.rs` (extracted to keep the production file under the
//! size gate; included via `#[path]`).
//!
//! The undo-of-a-move handshake (`prepare` → `commit`) is the data-loss-critical
//! part: a `prepare` must never destroy anything, and the source must only
//! restore from the ack the destination actually sent back.

use super::removal::{
    drop_pending_ack, pending_acks, register_pending_ack, route_ack, validate_phase, TabRemovalAck,
    REMOVAL_PHASE_COMMIT, REMOVAL_PHASE_PREPARE,
};
use super::*;

// The pending-ack registry is process-global, so these tests run serially.
static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn acquire_test_lock() -> std::sync::MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

fn reset_pending() {
    *pending_acks() = None;
}

fn live_data(content: &str) -> TabTransferData {
    TabTransferData {
        tab_id: "tab-1".to_string(),
        title: "Doc".to_string(),
        file_path: Some("/f.md".to_string()),
        content: content.to_string(),
        saved_content: "# Original".to_string(),
        is_dirty: true,
        workspace_root: None,
    }
}

fn prepare_ack(request_id: &str, content: &str) -> TabRemovalAck {
    TabRemovalAck {
        request_id: request_id.to_string(),
        tab_id: "tab-1".to_string(),
        phase: REMOVAL_PHASE_PREPARE.to_string(),
        accepted: true,
        reason: None,
        data: Some(live_data(content)),
    }
}

#[test]
fn point_inside_rect() {
    // window at (100,100) size 800x600 → (500,400) is inside.
    assert!(point_in_window_rect(100, 100, 800, 600, 500.0, 400.0));
}

#[test]
fn point_on_edge_is_inside() {
    // Top-left and bottom-right corners are inclusive.
    assert!(point_in_window_rect(100, 100, 800, 600, 100.0, 100.0));
    assert!(point_in_window_rect(100, 100, 800, 600, 900.0, 700.0));
}

#[test]
fn point_outside_rect() {
    assert!(!point_in_window_rect(100, 100, 800, 600, 50.0, 400.0)); // left of
    assert!(!point_in_window_rect(100, 100, 800, 600, 901.0, 400.0)); // right of
    assert!(!point_in_window_rect(100, 100, 800, 600, 500.0, 99.0)); // above
    assert!(!point_in_window_rect(100, 100, 800, 600, 500.0, 701.0)); // below
}

#[test]
fn zero_size_window_never_matches() {
    assert!(!point_in_window_rect(100, 100, 0, 600, 100.0, 100.0));
    assert!(!point_in_window_rect(100, 100, 800, 0, 100.0, 100.0));
}

#[test]
fn negative_origin_window() {
    // Windows can sit at negative coords on a multi-monitor setup.
    assert!(point_in_window_rect(-200, -100, 400, 300, -50.0, 50.0));
    assert!(!point_in_window_rect(-200, -100, 400, 300, 300.0, 50.0));
}

#[test]
fn ack_is_routed_to_the_waiting_request() {
    // The destination's ack must reach the exact request that is waiting on it —
    // this is what carries the destination's LIVE content back to the source.
    let _lock = acquire_test_lock();
    reset_pending();

    let mut rx = register_pending_ack("req-a");
    route_ack(prepare_ack("req-a", "# Edited in destination"));

    let ack = rx.try_recv().expect("waiting request must receive its ack");
    assert!(ack.accepted);
    assert_eq!(
        ack.data
            .expect("accepted prepare carries live data")
            .content,
        "# Edited in destination"
    );
    reset_pending();
}

#[test]
fn ack_for_unknown_request_is_a_no_op() {
    // A stale / misdirected ack must not disturb a pending request.
    let _lock = acquire_test_lock();
    reset_pending();

    let mut rx = register_pending_ack("req-a");
    route_ack(prepare_ack("req-other", "# Stale"));

    assert!(
        rx.try_recv().is_err(),
        "an ack for a different request must not resolve this one"
    );
    // The real request still resolves afterwards.
    route_ack(prepare_ack("req-a", "# Live"));
    assert!(rx.try_recv().is_ok());
    reset_pending();
}

#[test]
fn ack_is_delivered_once() {
    // A duplicate ack (destination retried) must not panic or resurrect a route.
    let _lock = acquire_test_lock();
    reset_pending();

    let mut rx = register_pending_ack("req-dup");
    route_ack(prepare_ack("req-dup", "# One"));
    route_ack(prepare_ack("req-dup", "# Two"));

    assert_eq!(
        rx.try_recv()
            .expect("first ack delivered")
            .data
            .expect("data")
            .content,
        "# One"
    );
    assert!(
        !pending_acks()
            .as_ref()
            .is_some_and(|map| map.contains_key("req-dup")),
        "a delivered request must be removed from the pending registry"
    );
    reset_pending();
}

#[test]
fn dropping_a_pending_request_frees_its_slot() {
    // Timeout / emit-failure path: the command drops its slot so the registry
    // can't grow without bound and a late ack routes nowhere.
    let _lock = acquire_test_lock();
    reset_pending();

    let mut rx = register_pending_ack("req-drop");
    drop_pending_ack("req-drop");

    assert!(!pending_acks()
        .as_ref()
        .is_some_and(|map| map.contains_key("req-drop")));
    route_ack(prepare_ack("req-drop", "# Late"));
    assert!(
        rx.try_recv().is_err(),
        "a late ack for a dropped request must not deliver"
    );
    reset_pending();
}

#[test]
fn only_known_phases_are_accepted() {
    // Guard the wire contract: an unknown phase must be rejected outright rather
    // than silently treated as "remove the tab".
    assert!(validate_phase(REMOVAL_PHASE_PREPARE).is_ok());
    assert!(validate_phase(REMOVAL_PHASE_COMMIT).is_ok());
    assert!(validate_phase("").is_err());
    assert!(validate_phase("delete").is_err());
}

#[test]
fn declined_ack_carries_no_data() {
    // A refusal must be representable on the wire — the source uses it to abort
    // the undo and leave the destination's tab intact.
    let ack = TabRemovalAck {
        request_id: "req-x".to_string(),
        tab_id: "tab-1".to_string(),
        phase: REMOVAL_PHASE_PREPARE.to_string(),
        accepted: false,
        reason: Some("tabNotFound".to_string()),
        data: None,
    };
    let json = serde_json::to_string(&ack).expect("ack serializes");
    assert!(json.contains("\"accepted\":false"));
    assert!(json.contains("\"requestId\""), "wire format is camelCase");

    // And it round-trips from what the destination window actually sends.
    let parsed: TabRemovalAck = serde_json::from_str(
        r#"{"requestId":"req-x","tabId":"tab-1","phase":"prepare","accepted":false,"reason":"tabNotFound"}"#,
    )
    .expect("optional fields may be omitted by the frontend");
    assert!(!parsed.accepted);
    assert!(parsed.data.is_none());
}
