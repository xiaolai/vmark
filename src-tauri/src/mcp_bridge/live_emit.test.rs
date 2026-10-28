//! Tests for `live_emit.rs` and the first send through it
//! (`routing::emit_to_window_or_reply`): a request a stop already drained is
//! never sent to the window, and its client still gets stop's answer.
//!
//! Edge cases: the entry drained with its client (stop), the client gone
//! with the entry left (disconnect), no target window, a live request
//! (sent once, with its id), and a second document window, which must never
//! receive a request routed to another window.

use super::{emit_while_live, LiveEmit};
use crate::mcp_bridge::managed::{bridge, McpBridgeState};
use crate::mcp_bridge::principal::BridgePrincipal;
use crate::mcp_bridge::routing::emit_to_window_or_reply;
use crate::mcp_bridge::state::{ClientConnection, PendingRequest};
use crate::mcp_bridge::types::{McpRequestEvent, McpResponse};
use serde_json::Value;
use tauri::test::MockRuntime;
use tauri::Listener;
use tokio::sync::{mpsc, oneshot};

fn mock_app(with_window: bool) -> tauri::App<MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    if with_window {
        tauri::webview::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("mock window");
    }
    app
}

fn sent(app: &tauri::App<MockRuntime>) -> mpsc::UnboundedReceiver<Value> {
    let (tx, rx) = mpsc::unbounded_channel();
    app.listen_any("mcp-bridge:request", move |event| {
        let _ = tx.send(serde_json::from_str(event.payload()).expect("json"));
    });
    rx
}

fn event(id: &str) -> McpRequestEvent {
    McpRequestEvent {
        id: id.to_string(),
        request_type: "document.write".to_string(),
        args_json: "{}".to_string(),
        attribution: crate::mcp_bridge::attribution::McpAttribution {
            principal: crate::mcp_bridge::attribution::PrincipalWire::Anonymous,
            connection_id: uuid::Uuid::nil().to_string(),
            session_label: Some("审阅".into()),
            display_name: None,
        },
    }
}

/// Client 1 connected with request `id` pending; the receiver is returned.
async fn pending(app: &tauri::App<MockRuntime>, id: &str) -> oneshot::Receiver<McpResponse> {
    let (tx, rx) = mpsc::channel(1);
    std::mem::forget(rx);
    let (response_tx, response_rx) = oneshot::channel();
    let mut guard = bridge(app.handle()).lock().await;
    guard.clients.insert(
        1,
        ClientConnection {
            tx,
            shutdown: None,
            identity: None,
            principal: BridgePrincipal::Anonymous,
            connection_id: uuid::Uuid::nil(),
        },
    );
    guard.pending.insert(
        id.to_string(),
        PendingRequest {
            response_tx,
            created_at: std::time::Instant::now(),
        },
    );
    response_rx
}

#[tokio::test]
async fn a_request_a_stop_drained_before_its_first_send_is_never_sent() {
    let app = mock_app(true);
    let mut events = sent(&app);
    let mut rx = pending(&app, "req-drained").await;
    crate::mcp_bridge::server::stop_bridge(app.handle()).await;
    let (client_tx, mut client_rx) = mpsc::channel(8);

    let carry_on = emit_to_window_or_reply(
        app.handle(),
        "main",
        &event("req-drained"),
        "document.write",
        "req-drained",
        1,
        &client_tx,
        "msg-1",
    )
    .await;

    assert!(events.try_recv().is_err(), "nothing sent after the stop");
    assert!(carry_on, "the caller collects stop's answer");
    let answer = rx.try_recv().expect("stop answered through the channel");
    assert_eq!(answer.error.as_deref(), Some("Bridge stopped"));
    assert!(client_rx.try_recv().is_err(), "the caller answers, once");
}

#[tokio::test]
async fn a_live_request_is_sent_once_with_its_id() {
    let app = mock_app(true);
    let mut events = sent(&app);
    let _rx = pending(&app, "req-live").await;
    assert!(matches!(
        emit_while_live(app.handle(), "main", &event("req-live"), 1).await,
        LiveEmit::Sent
    ));
    assert_eq!(events.try_recv().expect("sent")["id"], "req-live");
    assert!(events.try_recv().is_err(), "once");
}

#[tokio::test]
async fn a_disconnected_client_or_a_missing_window_sends_nothing() {
    let app = mock_app(false);
    let mut events = sent(&app);
    let _rx = pending(&app, "req-x").await;
    assert!(matches!(
        emit_while_live(app.handle(), "main", &event("req-x"), 1).await,
        LiveEmit::NoWindow
    ));
    bridge(app.handle()).lock().await.clients.clear();
    assert!(matches!(
        emit_while_live(app.handle(), "main", &event("req-x"), 1).await,
        LiveEmit::ClientGone
    ));
    assert!(events.try_recv().is_err());
}

/// Each document window's listener is scoped to its own label (the webview
/// side listens on its own window). A request routed to `doc-0` reaches
/// `doc-0` and never `main`: a broadcast made every open window run the
/// request, and the client got whichever answer came first.
#[tokio::test]
async fn a_request_reaches_its_target_window_and_no_other() {
    let app = mock_app(true);
    let doc =
        tauri::webview::WebviewWindowBuilder::new(&app, "doc-0", tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("second mock window");
    let main = tauri::Manager::get_webview_window(&app, "main").expect("main");
    let heard = |w: &tauri::WebviewWindow<MockRuntime>| {
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        w.listen("mcp-bridge:request", move |event| {
            let _ = tx.send(event.payload().to_string());
        });
        rx
    };
    let mut at_main = heard(&main);
    let mut at_doc = heard(&doc);
    let _rx = pending(&app, "req-doc").await;

    assert!(matches!(
        emit_while_live(app.handle(), "doc-0", &event("req-doc"), 1).await,
        LiveEmit::Sent
    ));

    let got: Value =
        serde_json::from_str(&at_doc.try_recv().expect("doc-0 received it")).expect("json");
    assert_eq!(got["id"], "req-doc");
    assert!(at_doc.try_recv().is_err(), "doc-0 received it once");
    assert!(
        at_main.try_recv().is_err(),
        "main received a request routed to doc-0"
    );
}
