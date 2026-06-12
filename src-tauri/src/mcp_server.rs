//! MCP Server Process Management
//!
//! Manages the MCP bridge WebSocket server and optional sidecar process.
//!
//! Architecture:
//! - The BRIDGE is a WebSocket server that AI sidecars connect to
//! - The SIDECAR is spawned by AI clients (Claude Code, Codex, etc.), NOT by VMark
//! - VMark only starts the bridge; AI clients spawn their own sidecars
//!
//! For development/testing, mcp_server_start can spawn a local sidecar,
//! but this should NOT be used when AI clients are configured to use VMark.

use crate::mcp_bridge;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Health check result from sidecar --health-check
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpHealthInfo {
    pub status: String,
    pub version: String,
    pub tool_count: usize,
    pub resource_count: usize,
    pub tools: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// MCP server process state (for an optional local sidecar killed on stop)
static MCP_SERVER: Mutex<Option<CommandChild>> = Mutex::new(None);

/// Bridge running state
static BRIDGE_RUNNING: AtomicBool = AtomicBool::new(false);

/// Monotonic start/stop generation. Each start (and stop) bumps it; a stale
/// accept-loop's on_exit callback compares its captured generation and
/// no-ops when superseded — otherwise a dying old loop could clobber the
/// NEW bridge's state and delete its port file (audit 20260612).
static BRIDGE_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Bridge port (stored when started)
static BRIDGE_PORT: Mutex<Option<u16>> = Mutex::new(None);

/// MCP server status for frontend
#[derive(Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    /// Whether a local sidecar is running (vs external AI client sidecar)
    #[serde(default)]
    pub local_sidecar: bool,
}

/// Start only the MCP bridge WebSocket server (no sidecar).
/// This is the recommended way to enable MCP - AI clients spawn their own sidecars.
/// The port parameter is ignored - the OS assigns an available port automatically.
/// The actual port is written to the app data directory (mcp-port) for sidecar discovery.
#[command]
pub async fn mcp_bridge_start(app: AppHandle, port: u16) -> Result<McpServerStatus, String> {
    // Atomically claim the not-running -> running transition. The previous
    // load-then-store pair let two concurrent starts both pass the check and
    // spawn two servers, leaking an unkillable accept loop (audit 20260612).
    if BRIDGE_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        let current_port = BRIDGE_PORT.lock().map_err(|e| e.to_string())?.unwrap_or(port);
        return Ok(McpServerStatus {
            running: true,
            port: Some(current_port),
            local_sidecar: false,
        });
    }

    let generation = BRIDGE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // Start the bridge WebSocket server (returns actual port assigned by OS).
    // The on_exit callback resets state if the server loop exits unexpectedly
    // — but only if this instance is still the current generation.
    let app_for_cleanup = app.clone();
    let actual_port = match mcp_bridge::start_bridge(app.clone(), port, move || {
        if BRIDGE_GENERATION.load(Ordering::SeqCst) != generation {
            log::debug!("[MCP] Stale bridge loop exited (gen {}) — state untouched", generation);
            return;
        }
        log::warn!("[MCP] Bridge server loop exited — resetting BRIDGE_RUNNING");
        BRIDGE_RUNNING.store(false, Ordering::SeqCst);
        if let Ok(mut p) = BRIDGE_PORT.lock() {
            *p = None;
        }
        mcp_bridge::remove_port_file(&app_for_cleanup);
    })
    .await
    {
        Ok(p) => p,
        Err(e) => {
            // Release the claim so a later start can retry.
            BRIDGE_RUNNING.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    {
        let mut port_guard = BRIDGE_PORT.lock().map_err(|e| e.to_string())?;
        *port_guard = Some(actual_port);
    }

    // Emit started event with actual port
    let _ = app.emit("mcp-server:started", actual_port);

    log::info!(
        "[MCP] Bridge started on port {} (waiting for AI client sidecars)",
        actual_port
    );

    Ok(McpServerStatus {
        running: true,
        port: Some(actual_port),
        local_sidecar: false,
    })
}

/// Stop the MCP bridge WebSocket server.
#[command]
pub async fn mcp_bridge_stop(app: AppHandle) -> Result<McpServerStatus, String> {
    // Supersede any in-flight loop so its on_exit can't clobber state that
    // a subsequent start writes (audit 20260612).
    BRIDGE_GENERATION.fetch_add(1, Ordering::SeqCst);

    // Stop the bridge
    mcp_bridge::stop_bridge(&app).await;

    // Mark bridge as stopped
    BRIDGE_RUNNING.store(false, Ordering::SeqCst);
    {
        let mut port_guard = BRIDGE_PORT.lock().map_err(|e| e.to_string())?;
        *port_guard = None;
    }

    // Also stop any local sidecar if running
    {
        let mut guard = MCP_SERVER.lock().map_err(|e| e.to_string())?;
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }

    // Emit stopped event
    let _ = app.emit("mcp-server:stopped", ());

    Ok(McpServerStatus {
        running: false,
        port: None,
        local_sidecar: false,
    })
}

/// Get the current MCP server status.
#[command]
pub fn mcp_server_status() -> Result<McpServerStatus, String> {
    let bridge_running = BRIDGE_RUNNING.load(Ordering::SeqCst);
    let port = *BRIDGE_PORT.lock().map_err(|e| e.to_string())?;
    let local_sidecar = MCP_SERVER.lock().map_err(|e| e.to_string())?.is_some();

    Ok(McpServerStatus {
        running: bridge_running,
        port,
        local_sidecar,
    })
}

/// Run MCP sidecar health check.
/// This runs the sidecar binary with --health-check flag to get real tool/version info.
#[command]
pub async fn mcp_sidecar_health(app: AppHandle) -> Result<McpHealthInfo, String> {
    let shell = app.shell();

    // Run sidecar with --health-check flag
    let output = shell
        .sidecar("vmark-mcp-server")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["--health-check"])
        .output()
        .await
        .map_err(|e| format!("Failed to run health check: {}", e))?;

    if output.status.success() {
        // Parse JSON output from sidecar
        let result: McpHealthInfo = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse health check output: {}", e))?;
        Ok(result)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Health check failed: {}", stderr))
    }
}

/// Get the number of connected MCP clients.
#[command]
pub async fn mcp_bridge_client_count() -> Result<usize, String> {
    Ok(mcp_bridge::client_count().await)
}

/// Get list of connected MCP clients with their identities.
#[command]
pub async fn mcp_bridge_connected_clients() -> Result<Vec<mcp_bridge::ConnectedClientInfo>, String>
{
    Ok(mcp_bridge::connected_clients().await)
}

/// Cleanup function to kill the MCP server on app exit.
/// Uses block_on to ensure cleanup completes before app exits.
pub fn cleanup(app: &AppHandle) {
    // Stop the bridge synchronously - must complete before exit
    let app_clone = app.clone();
    tauri::async_runtime::block_on(async move {
        mcp_bridge::stop_bridge(&app_clone).await;
    });

    BRIDGE_RUNNING.store(false, Ordering::SeqCst);

    // Stop the local sidecar if running
    if let Ok(mut guard) = MCP_SERVER.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}
