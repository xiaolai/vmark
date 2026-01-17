/**
 * MCP Server Process Management
 *
 * Manages the VMark MCP server sidecar process lifecycle.
 * The MCP server runs as a bundled Node.js executable that allows
 * AI assistants to control the editor via WebSocket.
 */

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// MCP server process state
static MCP_SERVER: Mutex<Option<CommandChild>> = Mutex::new(None);

/// MCP server status for frontend
#[derive(Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub running: bool,
    pub port: Option<u16>,
}

/// Start the MCP server sidecar process.
#[command]
pub async fn mcp_server_start(app: AppHandle, port: u16) -> Result<McpServerStatus, String> {
    // Check if already running
    {
        let guard = MCP_SERVER.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(McpServerStatus {
                running: true,
                port: Some(port),
            });
        }
    }

    // Spawn the sidecar process
    let shell = app.shell();
    let sidecar = shell
        .sidecar("vmark-mcp-server")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["--port", &port.to_string()]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server: {}", e))?;

    // Store the child process
    {
        let mut guard = MCP_SERVER.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    // Spawn a task to monitor the process output
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[MCP Server] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[MCP Server Error] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[MCP Server] Process terminated with code: {:?}",
                        payload.code
                    );

                    // Clear the stored process
                    if let Ok(mut guard) = MCP_SERVER.lock() {
                        *guard = None;
                    }

                    // Emit stopped event
                    let _ = app_handle.emit("mcp-server:stopped", ());
                    break;
                }
                _ => {}
            }
        }
    });

    // Emit started event
    let _ = app.emit("mcp-server:started", port);

    Ok(McpServerStatus {
        running: true,
        port: Some(port),
    })
}

/// Stop the MCP server sidecar process.
#[command]
pub async fn mcp_server_stop(app: AppHandle) -> Result<McpServerStatus, String> {
    let mut guard = MCP_SERVER.lock().map_err(|e| e.to_string())?;

    if let Some(child) = guard.take() {
        child.kill().map_err(|e| format!("Failed to kill MCP server: {}", e))?;
    }

    // Emit stopped event
    let _ = app.emit("mcp-server:stopped", ());

    Ok(McpServerStatus {
        running: false,
        port: None,
    })
}

/// Get the current MCP server status.
#[command]
pub fn mcp_server_status() -> Result<McpServerStatus, String> {
    let guard = MCP_SERVER.lock().map_err(|e| e.to_string())?;

    Ok(McpServerStatus {
        running: guard.is_some(),
        port: None, // We don't track port after start, could be enhanced
    })
}

/// Cleanup function to kill the MCP server on app exit.
pub fn cleanup() {
    if let Ok(mut guard) = MCP_SERVER.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}
