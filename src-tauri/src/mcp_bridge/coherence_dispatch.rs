//! Async dispatch for coherence requests, bounded.
//!
//! Purpose: answer every `vmark.coherence.*` request on a blocking thread so
//! the WebSocket receive loop keeps serving other clients, inside the
//! bridge's worst case (`WRITE_LOCK_WAIT` + `REQUEST_TIMEOUT_TOTAL`, which
//! the sidecar's `BRIDGE_WORST_CASE_MS` restates).
//!
//! Key decisions:
//! - The two that WRITE take the bridge write lock, serializing them with
//!   document writes: `edges` (its scan reconciliation appends provenance to
//!   the ledger) and `resolve` (it appends a receipt). The wait is bounded,
//!   refused WRITE_BUSY before anything runs.
//! - Admitted AFTER the write-lock wait, which can outlast a stop.
//! - The run is bounded by `REQUEST_TIMEOUT_TOTAL`. A blocking thread cannot
//!   be abandoned, so past the bound the client is answered `TIMEOUT` — for
//!   a write, with its outcome stated unknown, so it reads before retrying —
//!   while the run keeps the write lock and the operation lease until it
//!   really ends: no later write overlaps it, and a stop still waits for it
//!   (to the stop's own bound).
//!   The lock and lease are held by a spawned task that owns its `AppHandle`,
//!   which is what lets them outlive this request's answer.
//!
//! @coordinates-with mcp_bridge/state.rs — `WRITE_LOCK_WAIT`, `REQUEST_TIMEOUT_TOTAL`
//! @coordinates-with server/mcp/src/bridge/websocketConfig.ts — `BRIDGE_WORST_CASE_MS`
//! @module mcp_bridge/coherence_dispatch

use super::managed::bridge;
use super::principal::BridgePrincipal;
use super::routing::handle_rust_side;
use super::state::REQUEST_TIMEOUT_TOTAL;
use super::types::{McpRequest, McpResponse};
use std::time::Duration;
use tauri::{AppHandle, Runtime};

fn failure(error: String) -> McpResponse {
    McpResponse {
        success: false,
        data: None,
        error: Some(error),
    }
}

/// Answer a coherence request: the write-class ones under the write lock,
/// every one within `REQUEST_TIMEOUT_TOTAL` of its admission.
pub(super) async fn answer_coherence_async<R: Runtime>(
    request: &McpRequest,
    app: &AppHandle<R>,
    principal: BridgePrincipal,
    client_id: u64,
) -> McpResponse {
    let writes = request.request_type == "vmark.coherence.edges"
        || request.request_type == "vmark.coherence.resolve";
    let request = request.clone();
    let runner = app.clone();
    run_coherence_bounded(app, client_id, writes, REQUEST_TIMEOUT_TOTAL, move || {
        handle_rust_side(&request, &runner, &principal)
    })
    .await
}

/// Run `work` on a blocking thread for `client_id` — under the write lock
/// when it `writes` — and answer within `limit` of its admission.
pub(super) async fn run_coherence_bounded<R: Runtime>(
    app: &AppHandle<R>,
    client_id: u64,
    writes: bool,
    limit: Duration,
    work: impl FnOnce() -> Option<McpResponse> + Send + 'static,
) -> McpResponse {
    let (admitted_tx, admitted_rx) = tokio::sync::oneshot::channel::<Result<(), McpResponse>>();
    let (answer_tx, answer_rx) = tokio::sync::oneshot::channel::<McpResponse>();
    let app = app.clone();
    // Owns the app, so the lock and lease it takes live as long as the run,
    // not as long as this request's answer.
    // `tokio::spawn`, on the runtime serving the bridge (a test's paused
    // clock included), not Tauri's global one.
    tokio::spawn(async move {
        let bridge = bridge(&app);
        let _write_guard = if writes {
            match bridge.write_lock_for_request().await {
                Ok(guard) => Some(guard),
                Err(err) => {
                    let _ = admitted_tx.send(Err(failure(err)));
                    return;
                }
            }
        } else {
            None
        };
        let Some(_lease) = bridge.admit_operation(client_id).await else {
            let _ = admitted_tx.send(Err(failure("Bridge stopped".to_string())));
            return;
        };
        let _ = admitted_tx.send(Ok(()));
        let answer = tokio::task::spawn_blocking(work)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| failure("coherence request failed to execute".to_string()));
        let _ = answer_tx.send(answer);
    });
    match admitted_rx.await {
        Ok(Ok(())) => {}
        Ok(Err(refused)) => return refused,
        Err(_) => return failure("coherence request failed to execute".to_string()),
    }
    match tokio::time::timeout(limit, answer_rx).await {
        Ok(Ok(answer)) => answer,
        Ok(Err(_)) => failure("coherence request failed to execute".to_string()),
        Err(_) if writes => failure(format!(
            "TIMEOUT: the coherence write did not finish within {} s and is still running; its outcome is unknown. Read the current state before retrying.",
            limit.as_secs_f64()
        )),
        Err(_) => failure(format!(
            "TIMEOUT: the coherence request did not finish within {} s.",
            limit.as_secs_f64()
        )),
    }
}

#[cfg(all(test, not(target_os = "windows")))]
#[path = "coherence_dispatch.test.rs"]
mod tests;
