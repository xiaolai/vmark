//! `run` end to end on the mock runtime: a connected client's request is
//! emitted to the window as `mcp-bridge:request` carrying THAT client's
//! attribution, keyed by the pending entry it registered, and the window's
//! answer goes back to that client under its own message id.
//!
//! Edge cases: two clients connected at once (one attributed under a
//! provider credential with an identity and a CJK session label, one
//! anonymous with no identity), so an attribution read off the wrong client
//! or dropped field fails; a read-class and a write-class request, so both
//! lock paths are driven.

use super::run;
use crate::mcp_bridge::managed::{bridge, McpBridgeState};
use crate::mcp_bridge::principal::BridgePrincipal;
use crate::mcp_bridge::state::ClientConnection;
use crate::mcp_bridge::types::{ClientIdentity, McpRequest, McpResponse};
use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::Listener;
use tokio::sync::mpsc;

fn mock_app() -> tauri::App<MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    tauri::webview::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
        .visible(false)
        .build()
        .expect("mock window");
    app
}

/// Connect `client_id`; its receiver gets the replies.
async fn connect(
    app: &tauri::App<MockRuntime>,
    client_id: u64,
    principal: BridgePrincipal,
    identity: Option<ClientIdentity>,
    connection: u128,
) -> (mpsc::Sender<String>, mpsc::Receiver<String>) {
    let (tx, rx) = mpsc::channel(8);
    bridge(app.handle()).lock().await.clients.insert(
        client_id,
        ClientConnection {
            tx: tx.clone(),
            shutdown: None,
            identity,
            principal,
            connection_id: uuid::Uuid::from_u128(connection),
        },
    );
    (tx, rx)
}

/// Emitted `mcp-bridge:request` payloads, in order.
fn emitted(app: &tauri::App<MockRuntime>) -> mpsc::UnboundedReceiver<Value> {
    let (tx, rx) = mpsc::unbounded_channel();
    app.listen_any("mcp-bridge:request", move |event| {
        let _ = tx.send(serde_json::from_str(event.payload()).expect("json payload"));
    });
    rx
}

/// Run one request for `client_id`, play the window, and return the emitted
/// event and the client's reply.
async fn round_trip(
    app: &tauri::App<MockRuntime>,
    events: &mut mpsc::UnboundedReceiver<Value>,
    client_id: u64,
    client: (mpsc::Sender<String>, &mut mpsc::Receiver<String>),
    request_type: &str,
) -> (Value, Value) {
    let (client_tx, client_rx) = client;
    let handle = app.handle().clone();
    let request = McpRequest {
        request_type: request_type.to_string(),
        args: json!({ "probe": "中文🙂" }),
    };
    let task =
        tokio::spawn(
            async move { run(&handle, client_id, "msg-7".into(), request, &client_tx).await },
        );
    let event = events.recv().await.expect("the request reached the window");
    let id = event["id"].as_str().expect("id").to_string();
    let pending = bridge(app.handle())
        .lock()
        .await
        .pending
        .remove(&id)
        .expect("the emitted id is the registered pending key");
    pending
        .response_tx
        .send(McpResponse {
            success: true,
            data: Some(json!({ "for": client_id })),
            error: None,
        })
        .expect("run is waiting");
    task.await.expect("task").expect("run");
    let reply: Value =
        serde_json::from_str(&client_rx.try_recv().expect("the client was answered"))
            .expect("json reply");
    (event, reply)
}

#[tokio::test]
async fn each_emitted_request_carries_its_own_clients_attribution() {
    let app = mock_app();
    let mut events = emitted(&app);
    let identity = ClientIdentity {
        name: "claude-code".into(),
        version: Some("2.1".into()),
        session_label: Some("重构 session".into()),
    };
    let (tx1, mut rx1) = connect(
        &app,
        1,
        BridgePrincipal::Provider("claude".into()),
        Some(identity),
        0xa1,
    )
    .await;
    let (tx2, mut rx2) = connect(&app, 2, BridgePrincipal::Anonymous, None, 0xb2).await;

    let (event, reply) = round_trip(
        &app,
        &mut events,
        1,
        (tx1, &mut rx1),
        "vmark.document.write",
    )
    .await;
    assert_eq!(
        event["attribution"],
        json!({
            "principal": { "kind": "provider", "providerId": "claude" },
            "connectionId": "00000000-0000-0000-0000-0000000000a1",
            "sessionLabel": "重构 session",
            "displayName": "claude-code v2.1",
        })
    );
    assert_eq!(event["type"], "vmark.document.write");
    assert_eq!(
        serde_json::from_str::<Value>(event["args_json"].as_str().unwrap()).unwrap(),
        json!({ "probe": "中文🙂" })
    );
    assert_eq!(reply["id"], "msg-7");
    assert_eq!(reply["payload"]["data"], json!({ "for": 1 }));

    let (event, reply) =
        round_trip(&app, &mut events, 2, (tx2, &mut rx2), "vmark.document.read").await;
    assert_eq!(
        event["attribution"],
        json!({
            "principal": { "kind": "anonymous" },
            "connectionId": "00000000-0000-0000-0000-0000000000b2",
            "sessionLabel": null,
            "displayName": null,
        })
    );
    assert_eq!(reply["payload"]["data"], json!({ "for": 2 }));
    assert!(rx1.try_recv().is_err(), "client 1 got only its own reply");
    assert!(bridge(app.handle()).lock().await.pending.is_empty());
}

/// A stop that lands after a write was emitted and before its window answered
/// waits for that answer: the client gets the write's real outcome, never
/// "Bridge stopped" for a mutation the window still applies. A write that
/// arrives during the wait is refused before it is emitted.
#[tokio::test]
async fn a_stop_after_a_write_is_emitted_delivers_its_real_outcome() {
    let app = mock_app();
    let mut events = emitted(&app);
    let (tx, mut rx) = connect(&app, 1, BridgePrincipal::Anonymous, None, 0xc3).await;
    let write = |msg: &str| {
        let handle = app.handle().clone();
        let (tx, msg) = (tx.clone(), msg.to_string());
        tokio::spawn(async move {
            let request = McpRequest {
                request_type: "vmark.document.write".into(),
                args: json!({ "content": "新内容" }),
            };
            run(&handle, 1, msg, request, &tx).await
        })
    };
    let first = write("msg-1");
    let event = events.recv().await.expect("the write reached the window");
    let id = event["id"].as_str().expect("id").to_string();

    let handle = app.handle().clone();
    let stop = tokio::spawn(async move { crate::mcp_bridge::server::stop_bridge(&handle).await });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let second = write("msg-2");
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!stop.is_finished(), "the stop waits for the emitted write");

    let pending = bridge(app.handle())
        .lock()
        .await
        .pending
        .remove(&id)
        .expect("the emitted write is still waiting on its window");
    pending
        .response_tx
        .send(McpResponse {
            success: true,
            data: Some(json!({ "applied": true })),
            error: None,
        })
        .expect("run is waiting");
    first.await.expect("task").expect("run");
    tokio::time::timeout(std::time::Duration::from_secs(5), stop)
        .await
        .expect("the stop completes once the write is answered")
        .expect("stop task");
    second.await.expect("task").expect("run");

    let reply: Value = serde_json::from_str(&rx.try_recv().expect("first reply")).unwrap();
    assert_eq!(reply["id"], "msg-1");
    assert_eq!(reply["payload"]["success"], true);
    assert_eq!(reply["payload"]["data"], json!({ "applied": true }));
    let reply: Value = serde_json::from_str(&rx.try_recv().expect("second reply")).unwrap();
    assert_eq!(reply["id"], "msg-2");
    assert_eq!(reply["payload"]["success"], false);
    assert!(
        events.try_recv().is_err(),
        "the late write was never emitted"
    );
    assert!(bridge(app.handle()).lock().await.clients.is_empty());
}

/// A write queued behind a write that holds the lock waits only
/// `WRITE_LOCK_WAIT`, then is refused WRITE_BUSY — never registered, never
/// emitted — so its outcome is definite inside the client's own timeout.
#[tokio::test(start_paused = true)]
async fn a_write_behind_a_held_lock_is_refused_busy_at_the_bound() {
    let app = mock_app();
    let mut events = emitted(&app);
    let (tx, mut rx) = connect(&app, 1, BridgePrincipal::Anonymous, None, 0xd4).await;
    let held = bridge(app.handle()).write_lock().await;
    let started = tokio::time::Instant::now();
    let request = McpRequest {
        request_type: "vmark.document.write".into(),
        args: json!({ "content": "排队的写入" }),
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        run(app.handle(), 1, "msg-busy".into(), request, &tx),
    )
    .await
    .expect("the queued write is answered within its bound")
    .expect("run");
    assert_eq!(started.elapsed(), crate::mcp_bridge::state::WRITE_LOCK_WAIT);
    drop(held);

    let reply: Value = serde_json::from_str(&rx.try_recv().expect("answered")).unwrap();
    assert_eq!(reply["id"], "msg-busy");
    assert_eq!(reply["payload"]["success"], false);
    let error = reply["payload"]["error"].as_str().expect("error text");
    assert!(error.starts_with("WRITE_BUSY:"), "{error}");
    assert!(error.contains("not applied"), "{error}");
    assert!(
        events.try_recv().is_err(),
        "the refused write was never emitted"
    );
    assert!(bridge(app.handle()).lock().await.pending.is_empty());
}

/// A read never waits for the write lock, so a held lock refuses no read.
#[tokio::test(start_paused = true)]
async fn a_read_is_not_refused_while_a_write_holds_the_lock() {
    let app = mock_app();
    let mut events = emitted(&app);
    let (tx, mut rx) = connect(&app, 1, BridgePrincipal::Anonymous, None, 0xd5).await;
    let _held = bridge(app.handle()).write_lock().await;
    let (_, reply) = round_trip(&app, &mut events, 1, (tx, &mut rx), "vmark.document.read").await;
    assert_eq!(reply["payload"]["success"], true);
}
