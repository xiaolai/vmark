//! Tests for `delivery.rs` — envelope shape and bounded-queue outcomes.
//!
//! Each test owns its bridge state (WI-20). The `fail_pending` cases used to
//! key their entries under `__…__` markers and leave them in the process-wide
//! pending map; they use plain ids now because nothing else can see them.

use super::super::managed::McpBridgeState;
use super::*;

/// `send_error_response` must produce a `response` envelope carrying the
/// client's own message id and a failed `McpResponse` payload — this is the
/// reply shape every "answer instead of hang" path depends on.
#[tokio::test]
async fn send_error_response_writes_error_envelope() {
    let (tx, mut rx) = mpsc::channel::<String>(4);

    send_error_response(&McpBridgeState::default(), 7, &tx, "msg-42", "boom").await;

    let raw = rx.try_recv().expect("client must receive the error reply");
    let envelope: WsMessage = serde_json::from_str(&raw).expect("valid envelope JSON");
    assert_eq!(envelope.id, "msg-42");
    assert_eq!(envelope.msg_type, "response");
    let response: McpResponse =
        serde_json::from_value(envelope.payload).expect("valid response payload");
    assert!(!response.success);
    assert_eq!(response.error.as_deref(), Some("boom"));
    assert!(response.data.is_none());
}

/// `deliver_response` mirrors the same envelope contract for success payloads.
#[tokio::test]
async fn deliver_response_writes_response_envelope() {
    let (tx, mut rx) = mpsc::channel::<String>(4);
    let response = McpResponse {
        success: true,
        data: Some(serde_json::json!({"ok": true})),
        error: None,
    };

    deliver_response(
        &McpBridgeState::default(),
        7,
        &tx,
        "msg-1".to_string(),
        &response,
        "unused reason",
    )
    .await
    .expect("delivery must succeed");

    let raw = rx.try_recv().expect("client must receive the reply");
    let envelope: WsMessage = serde_json::from_str(&raw).expect("valid envelope JSON");
    assert_eq!(envelope.id, "msg-1");
    assert_eq!(envelope.msg_type, "response");
    let parsed: McpResponse = serde_json::from_value(envelope.payload).expect("valid payload");
    assert!(parsed.success);
    assert_eq!(parsed.data, Some(serde_json::json!({"ok": true})));
}

/// A full queue must never block or panic the sender — the message is
/// dropped and the outcome reported (escalation is the caller's job).
#[test]
fn enqueue_reports_queue_full_without_blocking() {
    let (tx, _rx) = mpsc::channel::<String>(1);
    assert_eq!(enqueue_client_msg(1, &tx, "a".into()), EnqueueOutcome::Sent);
    assert_eq!(
        enqueue_client_msg(1, &tx, "b".into()),
        EnqueueOutcome::QueueFull
    );
}

/// A dropped receiver reports `Closed`, not an error or panic.
#[test]
fn enqueue_reports_closed_receiver() {
    let (tx, rx) = mpsc::channel::<String>(1);
    drop(rx);
    assert_eq!(
        enqueue_client_msg(1, &tx, "a".into()),
        EnqueueOutcome::Closed
    );
}

// --- fail_pending: one cleanup policy, not five copies ----------------------

/// Audit round 1, finding 7: `fail_pending` lived in `server.rs` as a private
/// helper, so `routing.rs` kept its own copies of the same remove-unlock-send
/// sequence and cleanup policy was split across modules. It lives here now,
/// next to the delivery it performs, and both modules call it.
#[tokio::test]
async fn fail_pending_drops_the_entry_and_answers_the_client() {
    let (tx, mut rx) = mpsc::channel::<String>(4);
    let bridge = McpBridgeState::default();
    let request_id = "req-1";
    let (response_tx, response_rx) = tokio::sync::oneshot::channel();
    bridge.lock().await.pending.insert(
        request_id.to_string(),
        crate::mcp_bridge::state::PendingRequest {
            response_tx,
            created_at: std::time::Instant::now(),
        },
    );

    fail_pending(&bridge, request_id, 7, &tx, "msg-9", "window vanished").await;

    assert!(
        !bridge.lock().await.pending.contains_key(request_id),
        "the pending entry must be gone before the client is answered"
    );
    // Dropping the pending entry drops its oneshot sender.
    assert!(response_rx.await.is_err());

    let raw = rx
        .try_recv()
        .expect("client must receive the failure reply");
    let envelope: WsMessage = serde_json::from_str(&raw).expect("valid envelope JSON");
    assert_eq!(envelope.id, "msg-9");
    let response: McpResponse =
        serde_json::from_value(envelope.payload).expect("valid response payload");
    assert!(!response.success);
    assert_eq!(response.error.as_deref(), Some("window vanished"));
}

/// Failing an id that was never registered must still answer the client —
/// the retry paths call this after the entry may already have been swept.
#[tokio::test]
async fn fail_pending_answers_even_when_there_is_nothing_to_remove() {
    let (tx, mut rx) = mpsc::channel::<String>(4);

    fail_pending(
        &McpBridgeState::default(),
        "never-registered",
        8,
        &tx,
        "msg-10",
        "timeout",
    )
    .await;

    let raw = rx.try_recv().expect("client must still be answered");
    let envelope: WsMessage = serde_json::from_str(&raw).expect("valid envelope JSON");
    assert_eq!(envelope.id, "msg-10");
}

/// `fail_pending` must RELEASE the state lock before answering: the answer can
/// escalate to `force_disconnect_client`, which takes the same lock. Holding it
/// across the reply is a self-deadlock — and one this function cannot merely be
/// commented into avoiding, because a guard lives to the end of its scope.
///
/// The client here is backpressured to its cap, which is the only path that
/// reaches the escalation. Without the release, this test hangs rather than
/// fails, so it runs under an explicit deadline.
#[tokio::test]
async fn fail_pending_releases_the_state_lock_before_it_escalates() {
    let bridge = McpBridgeState::default();
    let (tx, _rx) = mpsc::channel::<String>(1);
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    bridge.lock().await.clients.insert(
        11,
        crate::mcp_bridge::state::ClientConnection {
            tx: tx.clone(),
            shutdown: Some(shutdown_tx),
            identity: None,
            principal: crate::mcp_bridge::principal::BridgePrincipal::Anonymous,
        },
    );
    // Fill the outbound queue so the reply cannot be enqueued.
    tx.try_send("occupies the only slot".to_string())
        .expect("first message fits");

    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        fail_pending(&bridge, "req-1", 11, &tx, "msg-11", "window vanished"),
    )
    .await
    .expect("fail_pending must not deadlock against its own escalation");

    assert!(
        shutdown_rx.await.is_ok(),
        "a client that lost its reply must be disconnected so it can retry"
    );
}
