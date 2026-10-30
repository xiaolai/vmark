//! `session.get_state` driven through the real `handle_message` entry point
//! (#1612): every document window is asked, each answers for itself, and the
//! client receives one merged session.
//!
//! Edge cases: a Finder-opened `doc-N` window beside `main` (the reported
//! case); a webview listing a stale record for another window, which must not
//! shadow that window's own answer; a utility window, which is never asked;
//! no document window at all; one window refusing; one window never
//! answering (App Nap), which must not leave a pending entry behind; a window
//! closed while awaited.

use crate::mcp_bridge::managed::{bridge, McpBridgeState};
use crate::mcp_bridge::principal::BridgePrincipal;
use crate::mcp_bridge::server::handle_message;
use crate::mcp_bridge::state::ClientConnection;
use crate::mcp_bridge::types::{McpResponse, WsMessage};
use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::Listener;
use tokio::sync::mpsc;

fn mock_app(labels: &[&str]) -> tauri::App<MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    for label in labels {
        tauri::webview::WebviewWindowBuilder::new(&app, *label, tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("mock window");
    }
    app
}

async fn connect(app: &tauri::App<MockRuntime>, client_id: u64) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel(8);
    bridge(app.handle()).lock().await.clients.insert(
        client_id,
        ClientConnection {
            tx,
            shutdown: None,
            identity: None,
            principal: BridgePrincipal::Anonymous,
            connection_id: uuid::Uuid::nil(),
        },
    );
    rx
}

/// Requests each window received, as `(label, event)`.
fn requests_by_window(
    app: &tauri::App<MockRuntime>,
    labels: &[&str],
) -> mpsc::UnboundedReceiver<(String, Value)> {
    let (tx, rx) = mpsc::unbounded_channel();
    for label in labels {
        let window = tauri::Manager::get_webview_window(app, label).expect("window");
        let tx = tx.clone();
        let label = label.to_string();
        window.listen("mcp-bridge:request", move |event| {
            let payload = serde_json::from_str(event.payload()).expect("json payload");
            let _ = tx.send((label.clone(), payload));
        });
    }
    rx
}

/// The next request any window received, bounded so a window that is never
/// asked fails the test instead of hanging it.
async fn next_request(
    requests: &mut mpsc::UnboundedReceiver<(String, Value)>,
) -> Option<(String, Value)> {
    tokio::time::timeout(std::time::Duration::from_secs(5), requests.recv())
        .await
        .ok()
        .flatten()
}

/// Answer pending request `id` the way a webview does.
async fn answer(app: &tauri::App<MockRuntime>, id: &str, response: McpResponse) {
    let pending = bridge(app.handle())
        .lock()
        .await
        .pending
        .remove(id)
        .expect("the emitted id is a registered pending key");
    pending
        .response_tx
        .send(response)
        .expect("fan-out is waiting");
}

fn window_record(label: &str, tab: &str) -> Value {
    json!({
        "label": label,
        "focused": false,
        "activeWorkspaceInstanceId": null,
        "tabs": [{ "id": tab, "kind": "markdown", "title": "笔记.md" }],
    })
}

fn state_from(windows: Vec<Value>) -> McpResponse {
    McpResponse {
        success: true,
        data: Some(json!({
            "windows": windows,
            "capabilities": { "version": "0.9.107", "mcpProtocol": "0.3.0" },
        })),
        error: None,
    }
}

fn get_state_message() -> String {
    json!({
        "id": "gs-1",
        "type": "request",
        "payload": { "type": "vmark.session.get_state", "clientProtocol": "0.3.0" },
    })
    .to_string()
}

fn reply(rx: &mut mpsc::Receiver<String>) -> McpResponse {
    let envelope: WsMessage =
        serde_json::from_str(&rx.try_recv().expect("the client was answered")).expect("envelope");
    assert_eq!(envelope.id, "gs-1");
    assert!(rx.try_recv().is_err(), "answered exactly once");
    serde_json::from_value(envelope.payload).expect("response")
}

async fn no_pending(app: &tauri::App<MockRuntime>) -> bool {
    bridge(app.handle()).lock().await.pending.is_empty()
}

/// The reported case: `main` and a Finder-opened `doc-8`, with no window
/// focused. Both are asked and both appear, in a stable order.
#[tokio::test]
async fn get_state_reports_every_document_window() {
    let app = mock_app(&["doc-8", "main", "settings"]);
    let mut rx = connect(&app, 1).await;
    let mut requests = requests_by_window(&app, &["main", "doc-8", "settings"]);

    let handle = app.handle().clone();
    let task = tokio::spawn(async move { handle_message(&get_state_message(), 1, &handle).await });

    let mut asked = Vec::new();
    for _ in 0..2 {
        let (label, event) = next_request(&mut requests)
            .await
            .expect("a window was asked");
        assert_eq!(event["type"], "vmark.session.get_state");
        assert_eq!(event["args_json"], r#"{"clientProtocol":"0.3.0"}"#);
        let id = event["id"].as_str().expect("id").to_string();
        // `main` also lists a stale, empty record for doc-8; doc-8's own
        // answer is the one that must survive.
        let windows = if label == "main" {
            vec![
                window_record("main", "t-main"),
                json!({ "label": "doc-8", "tabs": [] }),
            ]
        } else {
            vec![window_record(&label, "t-doc")]
        };
        answer(&app, &id, state_from(windows)).await;
        asked.push((label, id));
    }
    task.await.expect("task").expect("handled");

    let mut labels: Vec<&str> = asked.iter().map(|(l, _)| l.as_str()).collect();
    labels.sort_unstable();
    assert_eq!(
        labels,
        ["doc-8", "main"],
        "every document window, no utility window"
    );
    assert_ne!(asked[0].1, asked[1].1, "each window has its own pending id");
    assert!(requests.try_recv().is_err(), "each window asked once");

    let response = reply(&mut rx);
    assert!(response.success, "{:?}", response.error);
    let data = response.data.expect("data");
    assert_eq!(
        data["windows"],
        json!([
            window_record("main", "t-main"),
            window_record("doc-8", "t-doc")
        ])
    );
    assert_eq!(data["capabilities"]["version"], "0.9.107");
    assert!(no_pending(&app).await);
}

/// One window refusing fails the request loudly, naming the window — a
/// partial session would look complete to the client.
#[tokio::test]
async fn a_window_that_refuses_fails_the_request_and_names_it() {
    let app = mock_app(&["main", "doc-2"]);
    let mut rx = connect(&app, 1).await;
    let mut requests = requests_by_window(&app, &["main", "doc-2"]);

    let handle = app.handle().clone();
    let task = tokio::spawn(async move { handle_message(&get_state_message(), 1, &handle).await });
    for _ in 0..2 {
        let (label, event) = next_request(&mut requests).await.expect("asked");
        let id = event["id"].as_str().expect("id");
        let response = if label == "doc-2" {
            McpResponse {
                success: false,
                data: None,
                error: Some("NO_EDITOR".into()),
            }
        } else {
            state_from(vec![window_record("main", "t")])
        };
        answer(&app, id, response).await;
    }
    task.await.expect("task").expect("handled");

    let response = reply(&mut rx);
    assert!(!response.success);
    let error = response.error.expect("error");
    assert!(
        error.contains("doc-2") && error.contains("NO_EDITOR"),
        "{error}"
    );
    assert!(no_pending(&app).await);
}

/// A window whose answer omits its own record broke the contract; that is
/// an error, not a silently missing window.
#[tokio::test]
async fn a_window_that_omits_its_own_record_fails_the_request() {
    let app = mock_app(&["main"]);
    let mut rx = connect(&app, 1).await;
    let mut requests = requests_by_window(&app, &["main"]);

    let handle = app.handle().clone();
    let task = tokio::spawn(async move { handle_message(&get_state_message(), 1, &handle).await });
    let (_, event) = next_request(&mut requests).await.expect("asked");
    answer(&app, event["id"].as_str().expect("id"), state_from(vec![])).await;
    task.await.expect("task").expect("handled");

    let response = reply(&mut rx);
    assert!(!response.success);
    assert!(response.error.expect("error").contains("'main'"));
}

#[tokio::test]
async fn no_document_window_is_an_error_and_utility_windows_are_not_asked() {
    let app = mock_app(&["settings"]);
    let mut rx = connect(&app, 1).await;
    let mut requests = requests_by_window(&app, &["settings"]);

    handle_message(&get_state_message(), 1, app.handle())
        .await
        .expect("handled");

    let response = reply(&mut rx);
    assert!(!response.success);
    assert!(response
        .error
        .expect("error")
        .contains("No document window"));
    assert!(
        requests.try_recv().is_err(),
        "the settings window was not asked"
    );
    assert!(no_pending(&app).await);
}

/// A napping window that answers neither the request nor its wake-retry
/// times out the whole request, and its pending entry goes with it.
#[tokio::test(start_paused = true)]
async fn a_window_that_never_answers_times_out_without_leaking_its_entry() {
    let app = mock_app(&["main", "doc-3"]);
    let mut rx = connect(&app, 1).await;
    let mut requests = requests_by_window(&app, &["main", "doc-3"]);

    let handle = app.handle().clone();
    let task = tokio::spawn(async move { handle_message(&get_state_message(), 1, &handle).await });
    for _ in 0..2 {
        let (label, event) = next_request(&mut requests).await.expect("asked");
        if label == "main" {
            let id = event["id"].as_str().expect("id");
            answer(&app, id, state_from(vec![window_record("main", "t")])).await;
        }
    }
    task.await.expect("task").expect("handled");

    let response = reply(&mut rx);
    assert!(!response.success);
    let error = response.error.expect("error");
    assert!(
        error.contains("doc-3") && error.contains("timeout"),
        "{error}"
    );
    assert!(no_pending(&app).await);
}

/// A fresh Welcome window reports itself with no tabs; it is part of the
/// session beside a populated window, not a failure.
#[tokio::test]
async fn an_empty_window_is_reported_beside_a_populated_one() {
    let app = mock_app(&["main", "doc-3"]);
    let mut rx = connect(&app, 1).await;
    let mut requests = requests_by_window(&app, &["main", "doc-3"]);

    let handle = app.handle().clone();
    let task = tokio::spawn(async move { handle_message(&get_state_message(), 1, &handle).await });
    let empty_main =
        json!({ "label": "main", "focused": false, "activeWorkspaceInstanceId": null, "tabs": [] });
    for _ in 0..2 {
        let (label, event) = next_request(&mut requests).await.expect("asked");
        let record = if label == "main" {
            empty_main.clone()
        } else {
            window_record(&label, "t")
        };
        answer(
            &app,
            event["id"].as_str().expect("id"),
            state_from(vec![record]),
        )
        .await;
    }
    task.await.expect("task").expect("handled");

    let response = reply(&mut rx);
    assert!(response.success, "{:?}", response.error);
    assert_eq!(
        response.data.expect("data")["windows"],
        json!([empty_main, window_record("doc-3", "t")])
    );
}

/// A window closed after it was asked never answers: when its wait runs out
/// it has left the session, so it is skipped rather than reported as a
/// timeout, and no wake-retry is sent to it. The mock runtime cannot destroy
/// a window without its event loop, so the window here is already gone.
#[tokio::test(start_paused = true)]
async fn a_window_closed_while_awaited_is_skipped() {
    let app = mock_app(&["main"]);
    let _client = connect(&app, 1).await;
    let mut requests = requests_by_window(&app, &["main"]);
    let (_never_answered, mut response_rx) = tokio::sync::oneshot::channel::<McpResponse>();
    let event = crate::mcp_bridge::types::McpRequestEvent {
        id: "gs-doc-3".to_string(),
        request_type: super::SESSION_GET_STATE.to_string(),
        args_json: "{}".to_string(),
        attribution: crate::mcp_bridge::attribution::McpAttribution {
            principal: crate::mcp_bridge::attribution::PrincipalWire::Anonymous,
            connection_id: uuid::Uuid::nil().to_string(),
            session_label: None,
            display_name: None,
        },
    };

    let answer = super::await_window(app.handle(), "doc-3", &event, 1, &mut response_rx).await;

    assert_eq!(answer, Ok(None));
    assert!(requests.try_recv().is_err(), "nothing re-sent");
}
