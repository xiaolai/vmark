//! Tests for `delivery.rs` — envelope shape and bounded-queue outcomes.

use super::*;

/// `send_error_response` must produce a `response` envelope carrying the
/// client's own message id and a failed `McpResponse` payload — this is the
/// reply shape every "answer instead of hang" path depends on.
#[tokio::test]
async fn send_error_response_writes_error_envelope() {
    let (tx, mut rx) = mpsc::channel::<String>(4);

    send_error_response(7, &tx, "msg-42", "boom").await;

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

    deliver_response(7, &tx, "msg-1".to_string(), &response, "unused reason")
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
    let request_id = "__fail_pending_test__";
    let (response_tx, response_rx) = tokio::sync::oneshot::channel();
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.pending.insert(
            request_id.to_string(),
            crate::mcp_bridge::state::PendingRequest {
                response_tx,
                created_at: std::time::Instant::now(),
            },
        );
    }

    fail_pending(request_id, 7, &tx, "msg-9", "window vanished").await;

    {
        let state = get_bridge_state();
        let guard = state.lock().await;
        assert!(
            !guard.pending.contains_key(request_id),
            "the pending entry must be gone before the client is answered"
        );
    }
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

    fail_pending("__never_registered__", 8, &tx, "msg-10", "timeout").await;

    let raw = rx.try_recv().expect("client must still be answered");
    let envelope: WsMessage = serde_json::from_str(&raw).expect("valid envelope JSON");
    assert_eq!(envelope.id, "msg-10");
}
