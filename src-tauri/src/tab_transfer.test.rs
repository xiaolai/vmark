//! Tests for `tab_transfer.rs` (extracted to keep the production file under the
//! size gate; included via `#[path]`).
//!
//! The undo-of-a-move handshake (`prepare` → `commit`) is the data-loss-critical
//! part: a `prepare` must never destroy anything, and the source must only
//! restore from the ack the destination actually sent back.

use super::drop_target::point_in_window_rect;
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
        // The file's convention, which canonical content cannot carry.
        line_ending: None,
        hard_break_style: None,
        has_bom: None,
        last_disk_content: None,
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

// ---------------------------------------------------------------------------
// Detach ordering (#1301)
//
// `detach_tab_to_new_window` became `#[tauri::command(async)]` because a
// blocking window build deadlocks WebView2 on Windows. That moved the registry
// insert off the thread that creates the window, so the old "create, then
// register" order became a real gap: the target invokes `claim_tab_transfer`
// on mount, and a claim landing in the gap opens an EMPTY window with the
// user's tab nowhere. The payload is now registered first, exactly as
// `workspace_transfer.rs` documents for the same reason.

// tauri::test::MockRuntime crashes the test binary at startup on
// windows-latest (STATUS_ENTRYPOINT_NOT_FOUND). The `test` feature of tauri is
// not enabled on Windows (see Cargo.toml's target-specific dev-dependency), so
// `tauri::test` does not exist there and every caller is cfg-gated to match —
// the same treatment `fs_scope.test.rs` and `mcp_bridge/*.test.rs` already use.
// macOS/Linux still exercise the real runtime path.
#[cfg(not(target_os = "windows"))]
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// Drive the command's real body against a mock runtime. The `#[tauri::command]`
/// wrapper resolves to `Wry`, so the generic window helper is called the way the
/// command calls it — same order, same rollback.
#[cfg(not(target_os = "windows"))]
fn detach_into(app: &tauri::AppHandle<tauri::test::MockRuntime>, data: TabTransferData) -> String {
    let label = window_manager::allocate_window_label();
    registry()
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), data);
    tauri::webview::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::default())
        .visible(false)
        .build()
        .expect("build transfer window");
    label
}

#[cfg(not(target_os = "windows"))]
#[test]
fn the_payload_is_registered_before_the_window_can_claim_it() {
    let _lock = acquire_test_lock();
    *registry() = None;

    let app = mock_app();
    let label = detach_into(app.handle(), live_data("# Detached"));

    // The window exists AND the payload is already claimable — the ordering the
    // async command depends on.
    assert!(app.get_webview_window(&label).is_some());
    let claimed = claim_tab_transfer(label.clone()).expect("payload must be claimable at once");
    assert_eq!(claimed.content, "# Detached");
    // A claim is a take: a second one must not resurrect the tab.
    assert!(claim_tab_transfer(label).is_none());
}

#[test]
fn a_failed_window_build_leaves_no_orphan_transfer_entry() {
    let _lock = acquire_test_lock();
    *registry() = None;

    // Register first, as the command does, then fail the build the way a
    // duplicate label does — nothing would ever claim or destroy this entry.
    let label = window_manager::allocate_window_label();
    registry()
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), live_data("# Orphan"));
    clear_unclaimed_transfer(&label);

    assert!(
        claim_tab_transfer(label).is_none(),
        "a rolled-back detach must not leave the payload behind"
    );
}

#[test]
fn the_transfer_route_is_what_the_frontend_claims_on() {
    // The `?transfer=true` flag is the only thing that makes the new window
    // call `claim_tab_transfer` at all; a plain "/" opens an empty document.
    assert!(TRANSFER_URL.contains("transfer=true"));
    assert!(TRANSFER_URL.starts_with('/'));
}
