//! Tests for `server.rs` (moved from the inline `#[cfg(test)]` module;
//! included via `#[path]`).

use super::super::state::MAX_PENDING_REQUESTS;
use super::super::types::McpResponsePayload;
use super::*;

/// Bridge-internal ids must be unique even when minted concurrently —
/// they key the shared pending map, where a collision would silently drop
/// one client's response channel.
#[test]
fn bridge_request_ids_are_unique_and_prefixed() {
    let mut handles = Vec::new();
    for _ in 0..4 {
        handles.push(std::thread::spawn(|| {
            (0..250)
                .map(|_| next_bridge_request_id())
                .collect::<Vec<_>>()
        }));
    }
    let ids: Vec<String> = handles
        .into_iter()
        .flat_map(|h| h.join().expect("id-minting thread must not panic"))
        .collect();

    assert!(ids.iter().all(|id| id.starts_with("bridge-")));
    let unique: std::collections::HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len(), "ids must never collide");
}

// -- shared test plumbing ---------------------------------------------------

/// Serializes tests that drive `handle_message` against the SHARED global
/// bridge state — the queue-full test holds the pending map at cap and would
/// otherwise make a concurrently registering test observe a spurious
/// overload.
static GLOBAL_STATE_TEST_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
    std::sync::OnceLock::new();

fn global_state_test_lock() -> &'static tokio::sync::Mutex<()> {
    GLOBAL_STATE_TEST_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Register a fake connected client in the global bridge state and return
/// the receiving end of its outbound channel.
async fn register_test_client(client_id: u64) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel::<String>(8);
    let state = get_bridge_state();
    let mut guard = state.lock().await;
    guard.clients.insert(
        client_id,
        ClientConnection {
            tx,
            shutdown: None,
            identity: None,
        },
    );
    rx
}

async fn remove_test_client(client_id: u64) {
    let state = get_bridge_state();
    let mut guard = state.lock().await;
    guard.clients.remove(&client_id);
}

/// Parse an outbound envelope; asserts it is a `response` and returns
/// `(envelope id, response payload)`.
fn parse_reply(raw: &str) -> (String, McpResponse) {
    let envelope: WsMessage = serde_json::from_str(raw).expect("valid envelope JSON");
    assert_eq!(envelope.msg_type, "response");
    let response: McpResponse =
        serde_json::from_value(envelope.payload).expect("valid response payload");
    (envelope.id, response)
}

#[cfg(not(target_os = "windows"))]
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

// -- payload parse failures answer the client (Codex audit 20260718) --------

/// A valid envelope with a malformed MCP payload must produce an error
/// reply carrying the client's message id — not a log-only `Err` that
/// leaves the client hanging until its own 25s timeout.
#[tokio::test]
async fn invalid_payload_gets_error_reply_not_silence() {
    let (tx, mut rx) = mpsc::channel::<String>(8);

    let parsed = parse_request_or_reply(
        "msg-7",
        serde_json::json!({ "no_type_field": true }),
        42,
        &tx,
    )
    .await;

    assert!(parsed.is_none());
    let raw = rx.try_recv().expect("client must receive an error reply");
    let (id, response) = parse_reply(&raw);
    assert_eq!(id, "msg-7");
    assert!(!response.success);
    assert!(
        response
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("'type'"),
        "error should name the missing field: {:?}",
        response.error
    );
}

#[tokio::test]
async fn valid_payload_parses_without_reply() {
    let (tx, mut rx) = mpsc::channel::<String>(8);

    let request = parse_request_or_reply(
        "msg-1",
        serde_json::json!({ "type": "document.getContent", "windowId": "main" }),
        1,
        &tx,
    )
    .await
    .expect("valid payload must parse");

    assert_eq!(request.request_type, "document.getContent");
    assert!(rx.try_recv().is_err(), "no reply on the success path");
}

// -- correlation: bridge-internal ids, not client message ids ----------------

/// Two clients reusing the same client-side message id must each get their
/// own response: pending requests are keyed by bridge-internal ids, and the
/// frontend echoes that id back through `mcp_bridge_respond`.
#[tokio::test]
async fn same_client_msg_id_from_two_clients_resolves_independently() {
    let _guard = global_state_test_lock().lock().await;

    let bridge_id_a = next_bridge_request_id();
    let bridge_id_b = next_bridge_request_id();
    assert_ne!(bridge_id_a, bridge_id_b);

    let (tx_a, rx_a) = oneshot::channel::<McpResponse>();
    let (tx_b, rx_b) = oneshot::channel::<McpResponse>();
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        try_register_pending(&mut guard, bridge_id_a.clone(), tx_a).expect("register a");
        try_register_pending(&mut guard, bridge_id_b.clone(), tx_b).expect("register b");
    }

    // The frontend answers each bridge-internal id independently.
    super::super::commands::mcp_bridge_respond(McpResponsePayload {
        id: bridge_id_a,
        success: true,
        data: Some(serde_json::json!("for-a")),
        error: None,
    })
    .await
    .expect("respond a");
    super::super::commands::mcp_bridge_respond(McpResponsePayload {
        id: bridge_id_b,
        success: true,
        data: Some(serde_json::json!("for-b")),
        error: None,
    })
    .await
    .expect("respond b");

    assert_eq!(
        rx_a.await.expect("a resolved").data,
        Some(serde_json::json!("for-a"))
    );
    assert_eq!(
        rx_b.await.expect("b resolved").data,
        Some(serde_json::json!("for-b"))
    );
}

/// End-to-end variant on the error path: two clients send the SAME message
/// id, and each reply lands on its own channel (targeting distinct missing
/// windows keeps the two replies distinguishable).
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn same_msg_id_replies_route_to_each_clients_own_channel() {
    let _guard = global_state_test_lock().lock().await;
    let app = mock_app();
    let mut rx_a = register_test_client(9003).await;
    let mut rx_b = register_test_client(9004).await;

    let text_a = serde_json::json!({
        "id": "42",
        "type": "request",
        "payload": { "type": "document.getContent", "windowId": "doc-a-missing" },
    })
    .to_string();
    let text_b = serde_json::json!({
        "id": "42",
        "type": "request",
        "payload": { "type": "document.getContent", "windowId": "doc-b-missing" },
    })
    .to_string();

    handle_message(&text_a, 9003, app.handle())
        .await
        .expect("handled a");
    handle_message(&text_b, 9004, app.handle())
        .await
        .expect("handled b");

    let (id_a, resp_a) = parse_reply(&rx_a.try_recv().expect("client a reply"));
    let (id_b, resp_b) = parse_reply(&rx_b.try_recv().expect("client b reply"));
    assert_eq!(id_a, "42");
    assert_eq!(id_b, "42");
    assert!(resp_a.error.unwrap().contains("doc-a-missing"));
    assert!(resp_b.error.unwrap().contains("doc-b-missing"));
    assert!(rx_a.try_recv().is_err(), "exactly one reply per client");
    assert!(rx_b.try_recv().is_err(), "exactly one reply per client");

    remove_test_client(9003).await;
    remove_test_client(9004).await;
}

// -- overload: queue-full answers instead of hanging --------------------------

#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn queue_full_answers_client_with_error() {
    let _guard = global_state_test_lock().lock().await;
    let app = mock_app();
    let mut rx = register_test_client(9001).await;

    // Hold the pending map at cap with fresh (non-stale) entries.
    let mut fill_keys = Vec::new();
    let mut fill_rxs = Vec::new();
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        for i in 0..MAX_PENDING_REQUESTS {
            let key = format!("__queue_full_fill_{i}__");
            let (otx, orx) = oneshot::channel::<McpResponse>();
            guard.pending.insert(
                key.clone(),
                PendingRequest {
                    response_tx: otx,
                    created_at: Instant::now(),
                },
            );
            fill_keys.push(key);
            fill_rxs.push(orx);
        }
    }

    let text = serde_json::json!({
        "id": "q1",
        "type": "request",
        "payload": { "type": "document.getContent", "windowId": "main" },
    })
    .to_string();
    let result = handle_message(&text, 9001, app.handle()).await;

    // Release the cap before asserting so a failure can't wedge other tests.
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        for key in &fill_keys {
            guard.pending.remove(key);
        }
    }
    remove_test_client(9001).await;

    result.expect("overload must be answered, not returned as Err");
    let (id, response) = parse_reply(&rx.try_recv().expect("client must get overload reply"));
    assert_eq!(id, "q1");
    assert!(!response.success);
    assert_eq!(
        response.error.as_deref(),
        Some(
            format!(
                "MCP bridge pending request queue full ({} in flight)",
                MAX_PENDING_REQUESTS
            )
            .as_str()
        )
    );
}

// -- unknown target window answers instead of hanging -------------------------

#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn unknown_target_window_answers_client_with_error() {
    let _guard = global_state_test_lock().lock().await;
    let app = mock_app();
    let mut rx = register_test_client(9002).await;

    let text = serde_json::json!({
        "id": "w1",
        "type": "request",
        "payload": { "type": "document.getContent", "windowId": "doc-nonexistent" },
    })
    .to_string();
    let result = handle_message(&text, 9002, app.handle()).await;

    remove_test_client(9002).await;

    result.expect("unknown window must be answered, not returned as Err");
    let (id, response) = parse_reply(&rx.try_recv().expect("client must get error reply"));
    assert_eq!(id, "w1");
    assert!(!response.success);
    assert_eq!(
        response.error.as_deref(),
        Some("Target window 'doc-nonexistent' not found")
    );
}
