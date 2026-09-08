//! #167 — the initialization path, on a mock app.
//!
//! `start_bridge` was untestable while it took a Wry `AppHandle` and reached
//! the real port file and the developer's own `~/.claude.json`. Its two
//! out-of-process effects are parameters now, so what is pinned here is the
//! ORDER and the failure handling — the parts a reader can only otherwise take
//! on trust from the comments.

// tauri::test::MockRuntime dies at startup on windows-latest
// (STATUS_ENTRYPOINT_NOT_FOUND); the `test` feature of tauri is not enabled
// there, so this suite is gated like every other mock-runtime one here.
#![cfg(not(target_os = "windows"))]

use super::super::managed::{bridge, McpBridgeState};
use super::super::server::stop_bridge;
use super::start_bridge_with;
use crate::command_error::ErrorCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

#[tokio::test]
async fn a_start_publishes_the_bound_port_with_a_token_then_refreshes_the_client_registry() {
    let app = mock_app();
    let order: Arc<Mutex<Vec<&'static str>>> = Arc::default();
    let published: Arc<Mutex<Option<(u16, String)>>> = Arc::default();
    let (publish_order, publish_seen) = (Arc::clone(&order), Arc::clone(&published));
    let refresh_order = Arc::clone(&order);

    let port = start_bridge_with(
        app.handle().clone(),
        || {},
        move |port, token| {
            publish_order.lock().unwrap().push("publish");
            *publish_seen.lock().unwrap() = Some((port, token.to_string()));
            Ok(())
        },
        move || refresh_order.lock().unwrap().push("refresh"),
    )
    .await
    .expect("the bridge starts");

    let (published_port, token) = published
        .lock()
        .unwrap()
        .clone()
        .expect("the port file is written");
    assert_eq!(
        published_port, port,
        "the sidecar dials what the file says, so it must be the port that was BOUND"
    );
    assert!(!token.is_empty(), "a connection is authenticated by it");
    assert_eq!(
        *order.lock().unwrap(),
        vec!["publish", "refresh"],
        "the port is published only once the listener is up, and the client \
         registry is built before any connection can be judged against it"
    );
    assert!(
        bridge(app.handle()).shutdown_slot().await.is_some(),
        "a stop arriving now has something to signal"
    );

    stop_bridge(app.handle()).await;
}

#[tokio::test]
async fn a_publish_that_fails_refuses_the_start_and_leaves_no_listener_or_loop() {
    let app = mock_app();
    let bound: Arc<Mutex<Option<u16>>> = Arc::default();
    let seen = Arc::clone(&bound);
    let refreshed = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&refreshed);

    let err = start_bridge_with(
        app.handle().clone(),
        || {},
        move |port, _token| {
            *seen.lock().unwrap() = Some(port);
            Err("no space left on device".to_string())
        },
        move || flag.store(true, Ordering::SeqCst),
    )
    .await
    .expect_err("the port file could not be written");

    assert_eq!(err.code(), ErrorCode::Io);
    assert!(
        !refreshed.load(Ordering::SeqCst),
        "a refused start does no work after the failure"
    );
    assert!(
        bridge(app.handle()).shutdown_slot().await.is_none(),
        "no accept loop was spawned, so there is nothing for a stop to find"
    );
    let port = bound
        .lock()
        .unwrap()
        .expect("the listener was bound before the publish was attempted");
    std::net::TcpListener::bind(("127.0.0.1", port))
        .expect("the listener is dropped with the failed start, releasing its port");
}

/// Start and stop, joined: the loop the start spawned is the one the stop
/// signals. `BridgeLifecycle::serialize` is what keeps the two from
/// interleaving in the first place (#179, `lifecycle.rs`); this pins that the
/// pair actually works end to end on a live listener.
#[tokio::test]
async fn a_started_bridge_listens_and_its_loop_exits_when_the_bridge_is_stopped() {
    let app = mock_app();
    let (exited_tx, exited_rx) = oneshot::channel::<()>();

    let port = start_bridge_with(
        app.handle().clone(),
        move || {
            let _ = exited_tx.send(());
        },
        |_port, _token| Ok(()),
        || {},
    )
    .await
    .expect("the bridge starts");

    // The loop is real: something accepts on the port it reported.
    std::net::TcpStream::connect(("127.0.0.1", port)).expect("the accept loop is listening");

    stop_bridge(app.handle()).await;

    tokio::time::timeout(Duration::from_secs(5), exited_rx)
        .await
        .expect("the accept loop must exit when the bridge is stopped")
        .expect("`on_exit` fires so the lifecycle state can be reset");
}
