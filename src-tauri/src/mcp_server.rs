/**
 * MCP Server Process Management
 *
 * Manages the MCP bridge WebSocket server and optional sidecar process.
 *
 * Architecture:
 * - The BRIDGE is a WebSocket server that AI sidecars connect to
 * - The SIDECAR is spawned by AI clients (Claude Code, Codex, etc.), NOT by VMark
 * - VMark only starts the bridge; AI clients spawn their own sidecars
 *
 * For development/testing, mcp_server_start can spawn a local sidecar,
 * but this should NOT be used when AI clients are configured to use VMark.
 */

use crate::mcp_bridge;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// MCP server process state (for optional local sidecar)
static MCP_SERVER: Mutex<Option<CommandChild>> = Mutex::new(None);

/// Bridge running state
static BRIDGE_RUNNING: AtomicBool = AtomicBool::new(false);

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
/// The actual port is written to ~/.vmark/mcp-port for sidecar discovery.
#[command]
pub async fn mcp_bridge_start(app: AppHandle, port: u16) -> Result<McpServerStatus, String> {
    // Check if bridge is already running
    if BRIDGE_RUNNING.load(Ordering::SeqCst) {
        let current_port = BRIDGE_PORT.lock().map_err(|e| e.to_string())?.unwrap_or(port);
        return Ok(McpServerStatus {
            running: true,
            port: Some(current_port),
            local_sidecar: false,
        });
    }

    // Start the bridge WebSocket server (returns actual port assigned by OS)
    let actual_port = mcp_bridge::start_bridge(app.clone(), port).await?;

    // Mark bridge as running with actual port
    BRIDGE_RUNNING.store(true, Ordering::SeqCst);
    {
        let mut port_guard = BRIDGE_PORT.lock().map_err(|e| e.to_string())?;
        *port_guard = Some(actual_port);
    }

    // Emit started event with actual port
    let _ = app.emit("mcp-server:started", actual_port);

    #[cfg(debug_assertions)]
    eprintln!(
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
    // Stop the bridge
    mcp_bridge::stop_bridge().await;

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

/// Start the MCP bridge AND a local sidecar process.
/// This is mainly for development/testing. In production, AI clients spawn their own sidecars.
#[command]
pub async fn mcp_server_start(app: AppHandle, port: u16) -> Result<McpServerStatus, String> {
    // Check if local sidecar is already running
    let current_port = {
        let guard = MCP_SERVER.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            let port = BRIDGE_PORT.lock().map_err(|e| e.to_string())?.unwrap_or(port);
            return Ok(McpServerStatus {
                running: true,
                port: Some(port),
                local_sidecar: true,
            });
        }
        BRIDGE_PORT.lock().map_err(|e| e.to_string())?.clone()
    };

    // Start the bridge first (if not already running)
    let actual_port = if !BRIDGE_RUNNING.load(Ordering::SeqCst) {
        let actual = mcp_bridge::start_bridge(app.clone(), port).await?;
        BRIDGE_RUNNING.store(true, Ordering::SeqCst);
        {
            let mut port_guard = BRIDGE_PORT.lock().map_err(|e| e.to_string())?;
            *port_guard = Some(actual);
        }
        actual
    } else {
        current_port.unwrap_or(port)
    };

    // Small delay to ensure bridge is ready
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Spawn the sidecar process (no --port arg needed, it reads from file)
    let shell = app.shell();
    let sidecar = shell
        .sidecar("vmark-mcp-server")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar.spawn().map_err(|e| {
        format!("Failed to spawn MCP server: {}", e)
    })?;

    // Store the child process
    {
        let mut guard = MCP_SERVER.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    // Spawn a task to monitor the process output
    let _app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(_line) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[MCP Server] {}", String::from_utf8_lossy(&_line));
                }
                CommandEvent::Stderr(_line) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[MCP Server Error] {}", String::from_utf8_lossy(&_line));
                }
                CommandEvent::Terminated(_payload) => {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[MCP Server] Process terminated with code: {:?}",
                        _payload.code
                    );

                    // Clear the stored process
                    if let Ok(mut guard) = MCP_SERVER.lock() {
                        *guard = None;
                    }

                    break;
                }
                _ => {}
            }
        }
    });

    // Emit started event with actual port
    let _ = app.emit("mcp-server:started", actual_port);

    Ok(McpServerStatus {
        running: true,
        port: Some(actual_port),
        local_sidecar: true,
    })
}

/// Stop the MCP server (bridge + local sidecar).
#[command]
pub async fn mcp_server_stop(app: AppHandle) -> Result<McpServerStatus, String> {
    // Use the bridge stop which handles everything
    mcp_bridge_stop(app).await
}

/// Get the current MCP server status.
#[command]
pub fn mcp_server_status() -> Result<McpServerStatus, String> {
    let bridge_running = BRIDGE_RUNNING.load(Ordering::SeqCst);
    let port = BRIDGE_PORT.lock().map_err(|e| e.to_string())?.clone();
    let local_sidecar = MCP_SERVER.lock().map_err(|e| e.to_string())?.is_some();

    Ok(McpServerStatus {
        running: bridge_running,
        port,
        local_sidecar,
    })
}

/// Cleanup function to kill the MCP server on app exit.
pub fn cleanup() {
    // Stop the bridge
    tauri::async_runtime::spawn(async {
        mcp_bridge::stop_bridge().await;
    });

    BRIDGE_RUNNING.store(false, Ordering::SeqCst);

    // Stop the local sidecar if running
    if let Ok(mut guard) = MCP_SERVER.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}
