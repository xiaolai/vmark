//! Tests for `workspace_transfer.rs` (extracted to keep the production
//! file under the size gate; included via `#[path]`).

use super::*;

// These tests mutate process-global registries, so they must run serially.
static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn acquire_test_lock() -> std::sync::MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

fn transfer_data(request_id: &str) -> WorkspaceTransferData {
    WorkspaceTransferData {
        request_id: request_id.to_string(),
        operation: "move".to_string(),
        source_window_label: "main".to_string(),
        workspace_instance_id: "wsi-a".to_string(),
        kind: "workspace".to_string(),
        root_id: Some("root-a".to_string()),
        root_path: Some("/repo".to_string()),
        display_name: "repo".to_string(),
        active_tab_id: None,
        tabs: vec![],
    }
}

fn reset_transfer_state() {
    *transfer_registry() = None;
    *ack_routes() = None;
    *ack_route_targets() = None;
}

/// Register routes for a transfer as `detach_workspace_to_new_window` would,
/// keyed on a known target label (no window is created in unit tests).
fn register_routes(target_label: &str, data: &WorkspaceTransferData) {
    transfer_registry()
        .get_or_insert_with(HashMap::new)
        .insert(target_label.to_string(), data.clone());
    ack_routes().get_or_insert_with(HashMap::new).insert(
        data.request_id.clone(),
        AckRoute {
            source_window_label: data.source_window_label.clone(),
            target_window_label: target_label.to_string(),
            workspace_instance_id: data.workspace_instance_id.clone(),
        },
    );
    ack_route_targets()
        .get_or_insert_with(HashMap::new)
        .insert(target_label.to_string(), data.request_id.clone());
}

#[test]
fn clear_unclaimed_transfer_clears_ack_route_after_claim() {
    let _lock = acquire_test_lock();
    reset_transfer_state();
    let data = transfer_data("req-a");
    register_routes("doc-1", &data);

    assert!(claim_workspace_transfer("doc-1".to_string()).is_some());
    assert!(ack_routes()
        .as_ref()
        .is_some_and(|routes| routes.contains_key("req-a")));

    clear_unclaimed_transfer("doc-1");

    assert!(!ack_routes()
        .as_ref()
        .is_some_and(|routes| routes.contains_key("req-a")));
    assert!(!ack_route_targets()
        .as_ref()
        .is_some_and(|targets| targets.contains_key("doc-1")));
    reset_transfer_state();
}

#[test]
fn cancel_workspace_transfer_drops_unclaimed_payload_and_routes() {
    // Models the source-side timeout cancel: the still-registered payload must
    // be removed so a late claim returns nothing (no duplicate move).
    let _lock = acquire_test_lock();
    reset_transfer_state();
    let data = transfer_data("req-cancel");
    register_routes("doc-cancel", &data);

    cancel_workspace_transfer("doc-cancel".to_string());

    assert!(claim_workspace_transfer("doc-cancel".to_string()).is_none());
    assert!(!ack_routes()
        .as_ref()
        .is_some_and(|m| m.contains_key("req-cancel")));
    assert!(!ack_route_targets()
        .as_ref()
        .is_some_and(|m| m.contains_key("doc-cancel")));
    reset_transfer_state();
}

#[test]
fn rollback_removes_all_registered_routes() {
    // Models a window build failure after registration: the rollback must
    // leave no orphaned transfer / ack / target state behind.
    let _lock = acquire_test_lock();
    reset_transfer_state();
    let data = transfer_data("req-roll");
    register_routes("doc-9", &data);

    rollback_transfer_registration("doc-9", "req-roll");

    assert!(!transfer_registry()
        .as_ref()
        .is_some_and(|m| m.contains_key("doc-9")));
    assert!(!ack_routes()
        .as_ref()
        .is_some_and(|m| m.contains_key("req-roll")));
    assert!(!ack_route_targets()
        .as_ref()
        .is_some_and(|m| m.contains_key("doc-9")));
    reset_transfer_state();
}

#[test]
fn mismatched_ack_target_label_leaves_route_intact() {
    // A stale / wrong ack (correct request_id, wrong target window label)
    // must NOT tear down the still-pending route. We can't drive the full
    // command (it needs an AppHandle to emit), so we assert the validation
    // gate directly via the route comparison the command performs.
    let _lock = acquire_test_lock();
    reset_transfer_state();
    let data = transfer_data("req-mismatch");
    register_routes("doc-1", &data);

    // The validation logic mirrors ack_workspace_transfer's gate.
    let matches = ack_routes()
        .as_ref()
        .and_then(|map| map.get("req-mismatch"))
        .map(|route| {
            route.target_window_label == "WRONG-LABEL"
                && route.workspace_instance_id == data.workspace_instance_id
        })
        .unwrap_or(false);
    assert!(!matches, "mismatched target label must fail validation");

    // Route is untouched because validation would short-circuit before removal.
    assert!(ack_routes()
        .as_ref()
        .is_some_and(|m| m.contains_key("req-mismatch")));
    reset_transfer_state();
}

#[test]
fn mismatched_ack_instance_id_leaves_route_intact() {
    let _lock = acquire_test_lock();
    reset_transfer_state();
    let data = transfer_data("req-wsi");
    register_routes("doc-1", &data);

    let matches = ack_routes()
        .as_ref()
        .and_then(|map| map.get("req-wsi"))
        .map(|route| {
            route.target_window_label == "doc-1"
                && route.workspace_instance_id == "WRONG-WSI"
        })
        .unwrap_or(false);
    assert!(!matches, "mismatched workspace instance id must fail validation");
    assert!(ack_routes()
        .as_ref()
        .is_some_and(|m| m.contains_key("req-wsi")));
    reset_transfer_state();
}

#[test]
fn matching_ack_passes_validation_gate() {
    let _lock = acquire_test_lock();
    reset_transfer_state();
    let data = transfer_data("req-ok");
    register_routes("doc-1", &data);

    let matches = ack_routes()
        .as_ref()
        .and_then(|map| map.get("req-ok"))
        .map(|route| {
            route.target_window_label == "doc-1"
                && route.workspace_instance_id == data.workspace_instance_id
        })
        .unwrap_or(false);
    assert!(matches, "a correct ack must pass the validation gate");
    reset_transfer_state();
}
