//! Rust-answered operations and `stop_bridge`: an operation is admitted only
//! for a connected client, re-checked at the moment it would start (after
//! any wait for the write lock), and a stop completes only after every
//! operation it could not refuse, or at its bound.
//!
//! Edge cases: a client drained before the operation starts (synchronous
//! webview-bound request and a write-class coherence request, which first waits for
//! the write lock), a stop racing an admitted operation, an operation
//! admitted for a client that never connected.

use super::{bridge, McpBridgeState};
use crate::mcp_bridge::principal::BridgePrincipal;
use crate::mcp_bridge::routing::answer_rust_side;
use crate::mcp_bridge::state::ClientConnection;
use crate::mcp_bridge::types::McpRequest;
use std::time::Duration;
use tauri::test::MockRuntime;
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

async fn connect(app: &tauri::App<MockRuntime>, client_id: u64) {
    let (tx, rx) = mpsc::channel(1);
    std::mem::forget(rx);
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
}

fn request(request_type: &str) -> McpRequest {
    McpRequest {
        request_type: request_type.to_string(),
        args: serde_json::json!({ "note": "笔记" }),
    }
}

/// `handle_message` found the client, then a stop drained it before the
/// Rust-side answer ran: nothing runs, and the answer is "Bridge stopped".
#[tokio::test]
async fn a_rust_side_operation_for_a_drained_client_never_runs() {
    let app = mock_app();
    connect(&app, 1).await;
    crate::mcp_bridge::server::stop_bridge(app.handle()).await;

    for request_type in ["vmark.document.read", "vmark.coherence.resolve"] {
        let response = answer_rust_side(
            &request(request_type),
            app.handle(),
            BridgePrincipal::Anonymous,
            1,
        )
        .await
        .expect("answered in Rust");
        assert!(!response.success, "{request_type}");
        assert_eq!(
            response.error.as_deref(),
            Some("Bridge stopped"),
            "{request_type}"
        );
    }
}

/// A write-class coherence request waits for the write lock; a stop that
/// lands during that wait must still refuse it once the lock is free.
#[tokio::test]
async fn a_stop_during_the_write_lock_wait_refuses_the_mutation() {
    let app = mock_app();
    connect(&app, 1).await;
    let write = bridge(app.handle()).write_lock().await;
    // The stop queues for the write lock first, so it drains before the
    // request's wait ends.
    let handle = app.handle().clone();
    let stop = tokio::spawn(async move { crate::mcp_bridge::server::stop_bridge(&handle).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let handle = app.handle().clone();
    let op = tokio::spawn(async move {
        answer_rust_side(
            &request("vmark.coherence.resolve"),
            &handle,
            BridgePrincipal::Anonymous,
            1,
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    drop(write);
    stop.await.expect("stop task");

    let response = op.await.expect("task").expect("answered");
    assert_eq!(response.error.as_deref(), Some("Bridge stopped"));
}

#[tokio::test]
async fn an_unknown_client_is_never_admitted() {
    let app = mock_app();
    assert!(bridge(app.handle()).admit_operation(7).await.is_none());
}

/// An operation admitted before the drain holds its lease; the stop waits
/// for it, so it cannot report "stopped" while the operation still runs.
#[tokio::test]
async fn a_stop_completes_only_after_an_admitted_operation() {
    let app = mock_app();
    connect(&app, 1).await;
    let lease = bridge(app.handle())
        .admit_operation(1)
        .await
        .expect("a connected client is admitted");

    let handle = app.handle().clone();
    let stop = tokio::spawn(async move {
        crate::mcp_bridge::server::stop_bridge(&handle).await;
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        !stop.is_finished(),
        "the stop finished while an admitted operation was running"
    );
    assert!(
        bridge(app.handle()).lock().await.clients.is_empty(),
        "but the client was drained, so nothing new is admitted"
    );

    drop(lease);
    tokio::time::timeout(Duration::from_secs(5), stop)
        .await
        .expect("the stop completes once the operation ends")
        .expect("stop task");
}

/// An operation that outlives its own bound (a blocking run cannot be
/// abandoned) holds its lease past it; the stop waits for it to the bound and
/// no longer, so a stop — and the restart serialized behind it — never hangs.
#[tokio::test(start_paused = true)]
async fn a_stop_behind_an_operation_that_never_ends_completes_at_the_bound() {
    let app = mock_app();
    connect(&app, 1).await;
    let _endless = bridge(app.handle())
        .admit_operation(1)
        .await
        .expect("a connected client is admitted");
    let started = tokio::time::Instant::now();
    tokio::time::timeout(
        Duration::from_secs(600),
        crate::mcp_bridge::server::stop_bridge(app.handle()),
    )
    .await
    .expect("the stop completes");
    assert_eq!(
        started.elapsed(),
        crate::mcp_bridge::state::REQUEST_TIMEOUT_TOTAL
    );
    assert!(bridge(app.handle()).lock().await.clients.is_empty());
}

/// A write whose window never answers holds the write lock to the bound; the
/// stop waits that long and no longer, then drains.
#[tokio::test(start_paused = true)]
async fn a_stop_behind_a_hung_write_drains_at_the_bound() {
    let app = mock_app();
    connect(&app, 1).await;
    let _hung = bridge(app.handle()).write_lock().await;
    let started = tokio::time::Instant::now();
    crate::mcp_bridge::server::stop_bridge(app.handle()).await;
    assert_eq!(
        started.elapsed(),
        crate::mcp_bridge::state::REQUEST_TIMEOUT_TOTAL
    );
    assert!(bridge(app.handle()).lock().await.clients.is_empty());
}

/// The app exit stops at once, whatever holds the write lock: it stops on the
/// thread a window's answer would have to cross.
#[tokio::test(start_paused = true)]
async fn an_exit_stop_does_not_wait_for_writes() {
    use crate::mcp_bridge::{stop_bridge_with, InFlightWrites};
    let app = mock_app();
    connect(&app, 1).await;
    let _hung = bridge(app.handle()).write_lock().await;
    let started = tokio::time::Instant::now();
    stop_bridge_with(app.handle(), InFlightWrites::Abandon).await;
    assert_eq!(started.elapsed(), Duration::ZERO);
    assert!(bridge(app.handle()).lock().await.clients.is_empty());
}

/// A write-class coherence request behind a held write lock is refused
/// WRITE_BUSY at the bound, before it is admitted or runs.
#[tokio::test(start_paused = true)]
async fn a_coherence_write_behind_a_held_lock_is_refused_busy() {
    let app = mock_app();
    connect(&app, 1).await;
    let _held = bridge(app.handle()).write_lock().await;
    let started = tokio::time::Instant::now();
    let response = tokio::time::timeout(
        Duration::from_secs(60),
        answer_rust_side(
            &request("vmark.coherence.resolve"),
            app.handle(),
            BridgePrincipal::Anonymous,
            1,
        ),
    )
    .await
    .expect("the queued write is answered within its bound")
    .expect("answered in Rust");
    assert_eq!(started.elapsed(), crate::mcp_bridge::state::WRITE_LOCK_WAIT);
    assert!(!response.success);
    let error = response.error.expect("error");
    assert!(error.starts_with("WRITE_BUSY:"), "{error}");
}
