// WI-RA14B.3 — the App Nap wake-and-retry: after a first timeout the SAME
// request id is re-sent to the target window on the SAME response channel,
// and every way the retry can end answers the client exactly once — with the
// response, or with an error naming why — and leaves no pending entry behind.
// A response that lands between the first timeout and the retry is returned,
// and a stop at any point before the re-send means nothing is re-sent.

use super::super::managed::{bridge, McpBridgeState};
use super::super::principal::BridgePrincipal;
use super::super::state::{ClientConnection, PendingRequest};
use super::super::types::{McpRequestEvent, McpResponse};
use super::{retry_after_wake, wake_retry_after_timeout};
use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::Listener;
use tokio::sync::mpsc;

const TARGET: &str = "main";

fn mock_app(with_window: bool) -> tauri::App<MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    if with_window {
        tauri::webview::WebviewWindowBuilder::new(&app, TARGET, tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("mock window");
    }
    app
}

fn request(id: &str) -> McpRequestEvent {
    McpRequestEvent {
        id: id.to_string(),
        request_type: "document.read".to_string(),
        args_json: "{}".to_string(),
        attribution: crate::mcp_bridge::attribution::McpAttribution {
            principal: crate::mcp_bridge::attribution::PrincipalWire::Anonymous,
            connection_id: uuid::Uuid::nil().to_string(),
            session_label: None,
            display_name: None,
        },
    }
}

/// Re-emitted requests, as JSON payloads, in arrival order.
fn re_emits(app: &tauri::App<MockRuntime>) -> mpsc::UnboundedReceiver<Value> {
    let (tx, rx) = mpsc::unbounded_channel();
    app.listen_any("mcp-bridge:request", move |event| {
        let _ = tx.send(serde_json::from_str(event.payload()).expect("json payload"));
    });
    rx
}

type ResponseRx = tokio::sync::oneshot::Receiver<McpResponse>;

/// The state the request path leaves after its first wait: client 1
/// connected, and request `id` pending on the channel whose receiver the
/// first wait timed out on — returned, as the request path keeps it.
async fn in_flight(app: &tauri::App<MockRuntime>, id: &str) -> ResponseRx {
    let (tx, rx) = mpsc::channel(1);
    std::mem::forget(rx);
    let (first_tx, first_rx) = tokio::sync::oneshot::channel();
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
            response_tx: first_tx,
            created_at: std::time::Instant::now(),
        },
    );
    first_rx
}

/// Run the retry for request `id` on a task of its own, so the test can play
/// the webview meanwhile.
fn spawn_retry(
    app: &tauri::App<MockRuntime>,
    id: &'static str,
    response_rx: ResponseRx,
) -> (
    tokio::task::JoinHandle<Option<McpResponse>>,
    mpsc::Receiver<String>,
) {
    let (client_tx, client_rx) = mpsc::channel(8);
    let handle = app.handle().clone();
    let task = tokio::spawn(async move {
        let mut response_rx = response_rx;
        wake_retry_after_timeout(
            &handle,
            TARGET,
            &request(id),
            id,
            1,
            &client_tx,
            "msg-1",
            "document.read",
            &mut response_rx,
        )
        .await
    });
    (task, client_rx)
}

/// What the frontend's `mcp_bridge_respond` does: take the entry and answer
/// through it.
async fn respond(app: &tauri::App<MockRuntime>, id: &str, response: McpResponse) {
    let pending = bridge(app.handle())
        .lock()
        .await
        .pending
        .remove(id)
        .expect("the request is still pending");
    pending
        .response_tx
        .send(response)
        .expect("someone is waiting");
}

fn answer(text: &str) -> McpResponse {
    McpResponse {
        success: true,
        data: Some(json!({ "text": text })),
        error: None,
    }
}

/// The error the client was sent, from the one message it received.
fn client_error(client_rx: &mut mpsc::Receiver<String>) -> String {
    let message: Value =
        serde_json::from_str(&client_rx.try_recv().expect("one message")).expect("json");
    assert_eq!(message["id"], json!("msg-1"));
    assert!(client_rx.try_recv().is_err(), "answered exactly once");
    message["payload"]["error"]
        .as_str()
        .expect("an error")
        .to_string()
}

async fn has_pending(app: &tauri::App<MockRuntime>, id: &str) -> bool {
    bridge(app.handle()).lock().await.pending.contains_key(id)
}

#[tokio::test]
async fn the_same_request_is_re_sent_and_its_late_response_is_returned() {
    let app = mock_app(true);
    let mut emitted = re_emits(&app);
    let rx = in_flight(&app, "req-ok").await;
    let (task, mut client_rx) = spawn_retry(&app, "req-ok", rx);

    let resent = emitted.recv().await.expect("re-emitted");
    assert_eq!(
        resent["id"],
        json!("req-ok"),
        "the SAME id, so it is deduplicated"
    );
    respond(&app, "req-ok", answer("late but fine")).await;

    let response = task.await.expect("task").expect("the response");
    assert!(response.success);
    assert_eq!(response.data, Some(json!({ "text": "late but fine" })));
    assert!(
        client_rx.try_recv().is_err(),
        "the caller replies, not the retry"
    );
    assert!(
        !bridge(app.handle()).is_webview_alive(),
        "marked asleep until it answers"
    );
}

/// The webview answers just after the first wait gave up and before the
/// retry starts: that answer is the result — the write it reports was
/// applied — not a failure, and nothing is re-sent.
#[tokio::test]
async fn a_response_landing_between_the_timeout_and_the_retry_is_returned() {
    let app = mock_app(true);
    let mut emitted = re_emits(&app);
    let rx = in_flight(&app, "req-between").await;
    respond(&app, "req-between", answer("applied")).await;

    let (task, mut client_rx) = spawn_retry(&app, "req-between", rx);

    let response = task.await.expect("task").expect("the applied answer");
    assert_eq!(response.data, Some(json!({ "text": "applied" })));
    assert!(client_rx.try_recv().is_err(), "no error was sent");
    assert!(emitted.try_recv().is_err(), "nothing re-sent");
    assert!(!has_pending(&app, "req-between").await);
}

#[tokio::test]
async fn a_closed_target_window_fails_the_request_without_re_sending() {
    let app = mock_app(false);
    let mut emitted = re_emits(&app);
    let rx = in_flight(&app, "req-gone").await;
    let (task, mut client_rx) = spawn_retry(&app, "req-gone", rx);

    assert!(task.await.expect("task").is_none());

    assert!(client_error(&mut client_rx).contains("was closed during retry"));
    assert!(!has_pending(&app, "req-gone").await);
    assert!(emitted.try_recv().is_err(), "nothing re-sent");
}

#[tokio::test]
async fn a_dropped_retry_channel_fails_the_request() {
    let app = mock_app(true);
    let mut emitted = re_emits(&app);
    let rx = in_flight(&app, "req-dropped").await;
    let (task, mut client_rx) = spawn_retry(&app, "req-dropped", rx);

    emitted.recv().await.expect("re-emitted");
    drop(
        bridge(app.handle())
            .lock()
            .await
            .pending
            .remove("req-dropped"),
    );

    assert!(task.await.expect("task").is_none());
    assert_eq!(
        client_error(&mut client_rx),
        "Response channel closed on retry"
    );
}

#[tokio::test(start_paused = true)]
async fn no_answer_to_the_retry_either_is_a_timeout_error() {
    let app = mock_app(true);
    let mut emitted = re_emits(&app);
    let rx = in_flight(&app, "req-silent").await;
    let (task, mut client_rx) = spawn_retry(&app, "req-silent", rx);

    emitted.recv().await.expect("re-emitted");
    // The clock is paused: the runtime advances it to the timeout once every
    // task is idle, so this waits no real time.
    assert!(task.await.expect("task").is_none());

    let error = client_error(&mut client_rx);
    assert!(error.starts_with("Request timeout after 20s"), "{error}");
    assert!(!has_pending(&app, "req-silent").await);
}

/// A stop after the first wait gave up, before the retry: `stop_bridge`
/// drained the client and the entry and answered "Bridge stopped" through
/// it. That answer is returned and nothing is recreated or re-sent.
#[tokio::test]
async fn a_stop_before_the_retry_ends_it_without_re_sending() {
    let app = mock_app(true);
    let mut emitted = re_emits(&app);
    let rx = in_flight(&app, "req-stopped").await;
    crate::mcp_bridge::server::stop_bridge(app.handle()).await;

    let (task, mut client_rx) = spawn_retry(&app, "req-stopped", rx);

    let response = task.await.expect("task").expect("stop's answer");
    assert_eq!(response.error.as_deref(), Some("Bridge stopped"));
    assert!(client_rx.try_recv().is_err(), "the caller answers, once");
    assert!(!has_pending(&app, "req-stopped").await, "nothing recreated");
    assert!(emitted.try_recv().is_err(), "nothing re-sent");
}

/// The stop lands while the retry is waking the webview — after the retry
/// began, before it re-sends. The re-send must see the drain: a request
/// re-sent after shutdown could apply a mutation the client was already
/// told failed.
#[tokio::test]
async fn a_stop_while_waking_means_nothing_is_re_sent() {
    let app = mock_app(true);
    let mut emitted = re_emits(&app);
    let mut rx = in_flight(&app, "req-wake-stop").await;
    let (client_tx, mut client_rx) = mpsc::channel(8);
    let handle = app.handle().clone();

    let response = retry_after_wake(
        app.handle(),
        TARGET,
        &request("req-wake-stop"),
        "req-wake-stop",
        1,
        &client_tx,
        "msg-1",
        "document.read",
        &mut rx,
        async move { crate::mcp_bridge::server::stop_bridge(&handle).await },
    )
    .await;

    assert!(
        emitted.try_recv().is_err(),
        "nothing re-sent after the stop"
    );
    assert!(
        !has_pending(&app, "req-wake-stop").await,
        "nothing recreated"
    );
    let answered = match response {
        Some(r) => r.error.as_deref() == Some("Bridge stopped"),
        None => client_error(&mut client_rx) == "Bridge stopped",
    };
    assert!(answered, "the client learns the bridge stopped");
}
