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
