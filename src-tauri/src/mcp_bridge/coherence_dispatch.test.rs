//! A coherence request's run is bounded: past the bound the client gets a
//! definite answer — for a write, that its outcome is unknown — while the
//! run, which a blocking thread cannot abandon, keeps the write lock and its
//! operation lease until it really ends.
//!
//! Edge cases: a write past the bound, a read past the bound, a run that
//! ends in time, a run that panics, a stop behind a timed-out write.

use super::run_coherence_bounded;
use crate::mcp_bridge::managed::{bridge, McpBridgeState};
use crate::mcp_bridge::principal::BridgePrincipal;
use crate::mcp_bridge::state::ClientConnection;
use crate::mcp_bridge::types::McpResponse;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tauri::test::MockRuntime;
use tokio::sync::mpsc;

const BOUND: Duration = Duration::from_millis(50);

fn mock_app() -> tauri::App<MockRuntime> {
    tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
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

fn answered(note: &str) -> Option<McpResponse> {
    Some(McpResponse {
        success: true,
        data: Some(serde_json::json!({ "note": note })),
        error: None,
    })
}

/// Work that runs until `release` is sent (or dropped).
fn held_work() -> (
    std_mpsc::Sender<()>,
    impl FnOnce() -> Option<McpResponse> + Send + 'static,
) {
    let (release, wait) = std_mpsc::channel::<()>();
    (release, move || {
        let _ = wait.recv();
        answered("迟到")
    })
}

async fn write_lock_is_free(app: &tauri::App<MockRuntime>) -> bool {
    tokio::time::timeout(Duration::from_millis(20), bridge(app.handle()).write_lock())
        .await
        .map(drop)
        .is_ok()
}

#[tokio::test]
async fn a_write_past_the_bound_answers_its_outcome_is_unknown() {
    let app = mock_app();
    connect(&app, 1).await;
    let (release, work) = held_work();
    let started = std::time::Instant::now();
    let response = run_coherence_bounded(app.handle(), 1, true, BOUND, work).await;
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(!response.success);
    let error = response.error.expect("an error");
    assert!(error.starts_with("TIMEOUT:"), "{error}");
    assert!(error.contains("unknown"), "{error}");
    drop(release);
}

#[tokio::test]
async fn a_read_past_the_bound_answers_timeout_without_an_unknown_outcome() {
    let app = mock_app();
    connect(&app, 1).await;
    let (release, work) = held_work();
    let response = run_coherence_bounded(app.handle(), 1, false, BOUND, work).await;
    let error = response.error.expect("an error");
    assert!(error.starts_with("TIMEOUT:"), "{error}");
    assert!(!error.contains("unknown"), "{error}");
    drop(release);
}

#[tokio::test]
async fn a_timed_out_write_keeps_the_write_lock_until_its_run_ends() {
    let app = mock_app();
    connect(&app, 1).await;
    let (release, work) = held_work();
    let response = run_coherence_bounded(app.handle(), 1, true, BOUND, work).await;
    assert!(!response.success);
    assert!(
        !write_lock_is_free(&app).await,
        "the run still holds the lock"
    );
    release.send(()).expect("release");
    let _freed = tokio::time::timeout(Duration::from_secs(5), bridge(app.handle()).write_lock())
        .await
        .expect("the lock frees once the run ends");
}

#[tokio::test]
async fn a_stop_behind_a_timed_out_write_waits_for_its_run() {
    let app = mock_app();
    connect(&app, 1).await;
    let (release, work) = held_work();
    run_coherence_bounded(app.handle(), 1, false, BOUND, work).await;
    let handle = app.handle().clone();
    let stop = tokio::spawn(async move { crate::mcp_bridge::server::stop_bridge(&handle).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!stop.is_finished(), "the lease is still held");
    release.send(()).expect("release");
    tokio::time::timeout(Duration::from_secs(5), stop)
        .await
        .expect("the stop completes once the run ends")
        .expect("stop task");
}

#[tokio::test]
async fn a_run_within_the_bound_answers_and_frees_the_lock() {
    let app = mock_app();
    connect(&app, 1).await;
    let response = run_coherence_bounded(app.handle(), 1, true, Duration::from_secs(5), || {
        answered("准时")
    })
    .await;
    assert!(response.success);
    assert_eq!(response.data, Some(serde_json::json!({ "note": "准时" })));
    assert!(write_lock_is_free(&app).await);
}

#[tokio::test]
async fn a_run_that_panics_answers_a_failure() {
    let app = mock_app();
    connect(&app, 1).await;
    let response = run_coherence_bounded(app.handle(), 1, true, Duration::from_secs(5), || {
        panic!("boom")
    })
    .await;
    assert!(!response.success);
    assert_eq!(
        response.error.as_deref(),
        Some("coherence request failed to execute")
    );
    assert!(write_lock_is_free(&app).await);
}

#[tokio::test]
async fn a_drained_client_never_runs() {
    let app = mock_app();
    let response =
        run_coherence_bounded(app.handle(), 9, true, BOUND, || panic!("must not run")).await;
    assert_eq!(response.error.as_deref(), Some("Bridge stopped"));
}
