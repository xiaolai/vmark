// WI-AL1.5 — every removal of a client record tells the webviews which
// connection closed, so the read set tracked for it (one per client: client A's
// reads never serve client B) is dropped instead of leaking. Both removal
// paths are pinned: a connection's own teardown and a bridge stop that drains
// every record.
//! Tests for `connection_closed.rs` (included via `#[path]`).
#![cfg(not(target_os = "windows"))]

use super::super::connection::unregister_after;
use super::super::managed::{bridge, McpBridgeState};
use super::super::principal::BridgePrincipal;
use super::super::server::stop_bridge;
use super::super::state::ClientConnection;
use super::*;
use std::sync::{Arc, Mutex};
use tauri::Listener;
use tokio::sync::mpsc;

type MockApp = tauri::App<tauri::test::MockRuntime>;

fn mock_app() -> MockApp {
    tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// Every `connection-closed` payload, in emit order. Rust listeners run
/// inside the emit, so the list is final once the emitting call returns.
fn closed_payloads(app: &MockApp) -> Arc<Mutex<Vec<serde_json::Value>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    app.listen(CONNECTION_CLOSED_EVENT, move |event| {
        let value = serde_json::from_str(event.payload()).expect("payload is JSON");
        sink.lock().expect("sink").push(value);
    });
    seen
}

/// Register a client record holding `connection_id`; returns its writer task.
async fn register(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    client_id: u64,
    connection_id: uuid::Uuid,
) -> tauri::async_runtime::JoinHandle<()> {
    let (tx, mut rx) = mpsc::channel::<String>(4);
    let writer = tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
    bridge(app).lock().await.clients.insert(
        client_id,
        ClientConnection {
            tx,
            shutdown: None,
            identity: None,
            principal: BridgePrincipal::Anonymous,
            connection_id,
        },
    );
    writer
}

fn payload(connection_id: uuid::Uuid) -> serde_json::Value {
    serde_json::json!({ "connectionId": connection_id.hyphenated().to_string() })
}

#[tokio::test]
async fn a_connection_teardown_announces_its_connection_id() {
    let app = mock_app();
    let seen = closed_payloads(&app);
    let client_a = uuid::Uuid::new_v4();
    let client_b = uuid::Uuid::new_v4();
    let writer_a = register(app.handle(), 1, client_a).await;
    let _writer_b = register(app.handle(), 2, client_b).await;

    unregister_after(1, app.handle(), writer_a, async {}).await;

    // Only client A closed: client B's connection is not announced.
    assert_eq!(*seen.lock().unwrap(), vec![payload(client_a)]);
}

#[tokio::test]
async fn an_anonymous_unidentified_connection_is_announced_too() {
    // `clients-changed` fires only for identified clients; read tracking needs
    // every connection, identified or not.
    let app = mock_app();
    let seen = closed_payloads(&app);
    let id = uuid::Uuid::new_v4();
    let writer = register(app.handle(), 7, id).await;

    unregister_after(7, app.handle(), writer, async {}).await;

    assert_eq!(*seen.lock().unwrap(), vec![payload(id)]);
}

#[tokio::test]
async fn a_teardown_after_the_record_is_gone_announces_nothing_twice() {
    let app = mock_app();
    let id = uuid::Uuid::new_v4();
    let writer = register(app.handle(), 3, id).await;
    stop_bridge(app.handle()).await; // drains and announces
    let seen = closed_payloads(&app);

    unregister_after(3, app.handle(), writer, async {}).await;

    assert!(
        seen.lock().unwrap().is_empty(),
        "the stop already announced it"
    );
}

#[tokio::test]
async fn a_bridge_stop_announces_every_drained_connection() {
    let app = mock_app();
    let seen = closed_payloads(&app);
    let ids = [
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
    ];
    for (n, id) in ids.iter().enumerate() {
        let _writer = register(app.handle(), 10 + n as u64, *id).await;
    }

    stop_bridge(app.handle()).await;

    let mut got: Vec<_> = seen.lock().unwrap().clone();
    let mut want: Vec<_> = ids.iter().map(|id| payload(*id)).collect();
    let key = |v: &serde_json::Value| v["connectionId"].as_str().unwrap_or_default().to_owned();
    got.sort_by_key(key);
    want.sort_by_key(key);
    assert_eq!(got, want);
}

#[test]
fn the_payload_is_the_lower_case_hyphenated_id_the_webview_validates() {
    let id = uuid::Uuid::parse_str("ABCDEF00-0000-0000-0000-0000000A1000").unwrap();
    let value = serde_json::to_value(ConnectionClosed::new(id)).unwrap();
    assert_eq!(
        value,
        serde_json::json!({ "connectionId": "abcdef00-0000-0000-0000-0000000a1000" })
    );
}
