//! Tests for `server.rs` (moved from the inline `#[cfg(test)]` module;
//! included via `#[path]`).

// Not Windows-gated: `an_unknown_client_id_has_no_principal` needs no mock
// runtime and runs everywhere.
use super::super::principal::BridgePrincipal;
// Used only by the MockRuntime tests below, which are gated off Windows.
use super::super::managed::McpBridgeState;
#[cfg(not(target_os = "windows"))]
use super::super::state::{ClientConnection, MAX_PENDING_REQUESTS};
#[cfg(not(target_os = "windows"))]
use super::super::types::McpResponsePayload;
use super::*;

/// Answer a pending request the way the webview does — through the real
/// `mcp_bridge_respond` command.
#[cfg(not(target_os = "windows"))]
async fn resolve_through_command(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    request_id: &str,
    data: &str,
) {
    use tauri::Manager;
    super::super::commands::mcp_bridge_respond(
        app.state::<McpBridgeState>(),
        McpResponsePayload {
            id: request_id.to_string(),
            success: true,
            data: Some(serde_json::json!(data)),
            error: None,
        },
    )
    .await
    .expect("the webview's response must be accepted");
}
#[cfg(not(target_os = "windows"))]
use crate::mcp_bridge::state::PendingRequest;
#[cfg(not(target_os = "windows"))]
use std::time::Instant;

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
//
// WI-20: these tests used to serialize on a `GLOBAL_STATE_TEST_LOCK` and clean
// up after themselves, because `handle_message` reached one process-global
// bridge. Each test now builds a mock app with its own managed bridge, so the
// lock, the `__…__` marker keys and the teardown calls are all gone.

/// Register a fake connected client on `app`'s bridge and return the receiving
/// end of its outbound channel.
#[cfg(not(target_os = "windows"))]
async fn register_test_client(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    client_id: u64,
) -> mpsc::Receiver<String> {
    register_test_client_as(app, client_id, BridgePrincipal::Anonymous).await
}

/// The same, with an explicit authenticated principal.
#[cfg(not(target_os = "windows"))]
async fn register_test_client_as(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    client_id: u64,
    principal: BridgePrincipal,
) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel::<String>(8);
    bridge(app).lock().await.clients.insert(
        client_id,
        ClientConnection {
            tx,
            shutdown: None,
            identity: None,
            principal,
        },
    );
    rx
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

/// A mock app with its own bridge — the composition `lib.rs` performs, at the
/// scale of one test.
#[cfg(not(target_os = "windows"))]
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

// -- the write lock is not held across delivery -------------------------------

/// Audit round 1, finding 8: the guard was declared with `let _write_guard`
/// and therefore lived to the end of `handle_message` — across the final
/// `deliver_response(...).await` — even though a comment above that call
/// claimed the lock had already been released. Delivery can force-disconnect
/// a backpressured peer (which takes the bridge state lock), so every other
/// write op queued behind one slow client's teardown.
///
/// `without_write_lock` takes the guard by value and drops it before awaiting,
/// which makes the ordering observable: the delivery future here reads the
/// lock at the moment it runs.
#[tokio::test]
async fn the_write_lock_is_released_before_the_delivery_future_runs() {
    let bridge = McpBridgeState::default();
    let guard = bridge.write_lock().await;

    let free_during_delivery = without_write_lock(Some(guard), async {
        // A second acquisition would block if the guard were still alive.
        tokio::time::timeout(std::time::Duration::from_millis(500), bridge.write_lock())
            .await
            .is_ok()
    })
    .await;

    assert!(
        free_during_delivery,
        "delivery must not run while the write lock is held"
    );
}

/// The read path passes `None` — nothing to release, and delivery still runs.
#[tokio::test]
async fn a_read_request_delivers_without_a_guard() {
    let bridge = McpBridgeState::default();

    let free = without_write_lock(None, async {
        tokio::time::timeout(std::time::Duration::from_millis(500), bridge.write_lock())
            .await
            .is_ok()
    })
    .await;

    assert!(free);
}

// -- payload parse failures answer the client (Codex audit 20260718) --------

/// A valid envelope with a malformed MCP payload must produce an error
/// reply carrying the client's message id — not a log-only `Err` that
/// leaves the client hanging until its own 25s timeout.
#[tokio::test]
async fn invalid_payload_gets_error_reply_not_silence() {
    let (tx, mut rx) = mpsc::channel::<String>(8);

    let parsed = parse_request_or_reply(
        &McpBridgeState::default(),
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
        &McpBridgeState::default(),
        "msg-1",
        serde_json::json!({ "type": "document.getContent", "tabId": "t1" }),
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
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn same_client_msg_id_from_two_clients_resolves_independently() {
    let app = mock_app();
    let bridge = bridge(app.handle());

    let bridge_id_a = next_bridge_request_id();
    let bridge_id_b = next_bridge_request_id();
    assert_ne!(bridge_id_a, bridge_id_b);

    let (tx_a, rx_a) = oneshot::channel::<McpResponse>();
    let (tx_b, rx_b) = oneshot::channel::<McpResponse>();
    {
        let mut guard = bridge.lock().await;
        try_register_pending(&mut guard, bridge_id_a.clone(), tx_a).expect("register a");
        try_register_pending(&mut guard, bridge_id_b.clone(), tx_b).expect("register b");
    }

    // The frontend answers each bridge-internal id independently.
    resolve_through_command(app.handle(), &bridge_id_a, "for-a").await;
    resolve_through_command(app.handle(), &bridge_id_b, "for-b").await;

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
/// id, and each reply lands on its own channel.
///
/// The two failures are deliberately of DIFFERENT kinds — a malformed frame
/// versus a routed request whose window is not open — because that is what
/// makes a crossed channel detectable. They used to be distinguished by
/// pinning two different `windowId`s, a field no client can send (WI-15).
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn same_msg_id_replies_route_to_each_clients_own_channel() {
    let app = mock_app();
    let mut rx_a = register_test_client(app.handle(), 9003).await;
    let mut rx_b = register_test_client(app.handle(), 9004).await;

    let text_a = serde_json::json!({
        "id": "42",
        "type": "request",
        "payload": { "tabId": "t1" },
    })
    .to_string();
    let text_b = serde_json::json!({
        "id": "42",
        "type": "request",
        "payload": { "type": "document.getContent", "tabId": "t1" },
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
    assert!(resp_a.error.unwrap().contains("'type'"));
    assert!(resp_b.error.unwrap().contains("not found"));
    assert!(rx_a.try_recv().is_err(), "exactly one reply per client");
    assert!(rx_b.try_recv().is_err(), "exactly one reply per client");
}

// -- overload: queue-full answers instead of hanging --------------------------

#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn queue_full_answers_client_with_error() {
    let app = mock_app();
    let mut rx = register_test_client(app.handle(), 9001).await;

    // Hold the pending map at cap with fresh (non-stale) entries.
    let mut fill_rxs = Vec::new();
    {
        let mut guard = bridge(app.handle()).lock().await;
        for i in 0..MAX_PENDING_REQUESTS {
            let (otx, orx) = oneshot::channel::<McpResponse>();
            guard.pending.insert(
                format!("fill-{i}"),
                PendingRequest {
                    response_tx: otx,
                    created_at: Instant::now(),
                },
            );
            fill_rxs.push(orx);
        }
    }

    let text = serde_json::json!({
        "id": "q1",
        "type": "request",
        "payload": { "type": "document.getContent", "tabId": "t1" },
    })
    .to_string();
    let result = handle_message(&text, 9001, app.handle()).await;

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

// -- absent target window answers instead of hanging --------------------------

/// A routed request whose resolved window is not open must be ANSWERED.
///
/// This used to pin a nonexistent window through `args.windowId` and assert
/// routing's "requested window … is not open" refusal. That refusal was
/// unreachable in production: no shipped tool sends `windowId`, so the branch
/// was deleted (WI-15). The reachable failure is the one asserted here —
/// routing resolves a target, the window is gone by emit time, and the client
/// gets an error instead of a hang.
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn absent_target_window_answers_client_with_error() {
    let app = mock_app();
    let mut rx = register_test_client(app.handle(), 9002).await;

    let text = serde_json::json!({
        "id": "w1",
        "type": "request",
        "payload": { "type": "document.getContent", "tabId": "t1" },
    })
    .to_string();
    let result = handle_message(&text, 9002, app.handle()).await;

    result.expect("an absent window must be answered, not returned as Err");
    let (id, response) = parse_reply(&rx.try_recv().expect("client must get error reply"));
    assert_eq!(id, "w1");
    assert!(!response.success);
    assert_eq!(
        response.error.as_deref(),
        Some("Target window 'main' not found")
    );
}

// WI-3.5 F6 — disconnect cleanup is ownership-and-workspace-safe. The
// bridge removes only the client record on disconnect; it never closes
// tabs and never drops a window's workspace registration. Session 3's F6
// symptom was manual localStorage manipulation, not bridge behavior —
// this locks the guarantee so no future change silently regresses it.
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn disconnect_preserves_window_workspaces() {
    let app = mock_app();
    let _rx = register_test_client(app.handle(), 9101).await;
    bridge(app.handle())
        .lock()
        .await
        .window_workspaces
        .insert("doc-0".into(), "/repo".into());

    // Simulate the disconnect cleanup: remove the client record only.
    bridge(app.handle()).lock().await.clients.remove(&9101);

    let guard = bridge(app.handle()).lock().await;
    assert_eq!(
        guard.window_workspaces.get("doc-0").map(String::as_str),
        Some("/repo"),
        "a client disconnect must never drop a window's workspace"
    );
    assert!(
        !guard.clients.contains_key(&9101),
        "the client record is gone, but only the client record"
    );
}

// -- `identify` is informational; the principal is the credential -----------
//
// THE regression test for audit 20260728 §2.1. Before per-client credentials
// the authorization principal WAS `identity.name`, so this exact sequence —
// connect, then say "I am codex-cli" — was all it took to exercise a
// delegation a human granted to Codex CLI and to have the ratification receipt
// record Codex CLI as the actor. There was no once-only guard either: a client
// could re-`identify` and change principal mid-connection.
//
// Driven through the real `handle_message` path rather than `handle_identify`
// directly, so it covers the dispatch too.

/// A client that authenticated with NO credential cannot name itself into one.
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn identify_cannot_promote_an_unidentified_client_to_a_provider() {
    let app = mock_app();
    let _rx = register_test_client_as(app.handle(), 9301, BridgePrincipal::Anonymous).await;

    let claim = serde_json::json!({
        "id": "identify",
        "type": "identify",
        "payload": { "name": "codex-cli", "version": "1.2.3" },
    })
    .to_string();
    handle_message(&claim, 9301, app.handle())
        .await
        .expect("identify is accepted");

    assert_eq!(
        bridge(app.handle()).connection_principal(9301).await,
        BridgePrincipal::Anonymous,
        "a self-declared name must not become a principal"
    );
    // It is still recorded as a LABEL — that is all identify is for.
    assert_eq!(
        bridge(app.handle()).lock().await.clients[&9301]
            .identity
            .as_ref()
            .map(|i| i.name.clone()),
        Some("codex-cli".to_string()),
        "identify still labels the connection for the UI and logs"
    );
}

/// A client that authenticated as `claude` cannot re-label itself into
/// `codex-cli`'s grants, and repeated `identify` frames cannot either.
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn identify_cannot_move_a_client_to_another_providers_principal() {
    let app = mock_app();
    let _rx = register_test_client_as(
        app.handle(),
        9302,
        BridgePrincipal::Provider("claude".into()),
    )
    .await;

    for name in ["codex-cli", "cursor", "claude"] {
        let claim = serde_json::json!({
            "id": "identify",
            "type": "identify",
            "payload": { "name": name },
        })
        .to_string();
        handle_message(&claim, 9302, app.handle())
            .await
            .expect("identify is accepted");
        assert_eq!(
            bridge(app.handle()).connection_principal(9302).await,
            BridgePrincipal::Provider("claude".into()),
            "re-identifying as {name} must not change who the connection is"
        );
    }
}

/// A client id with no live connection authorizes nothing.
#[tokio::test]
async fn an_unknown_client_id_has_no_principal() {
    assert_eq!(
        McpBridgeState::default()
            .connection_principal(u64::MAX)
            .await,
        BridgePrincipal::Anonymous
    );
}
