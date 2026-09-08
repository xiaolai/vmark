//! The MCP sidecar's `--health-check` probe (split from `mcp_server.rs` at the
//! file-size limit).
//!
//! It spawns the sidecar binary, drains its pipes and parses the one JSON line
//! it prints. That shares nothing with the bridge lifecycle it used to sit
//! beside — no listener, no generation, no managed state — beyond both being
//! shown in Settings → Integrations.
//!
//! @coordinates-with mcp_server.rs — the bridge lifecycle it was split from
//! @coordinates-with src/hooks/useMcpHealthCheck.ts — the caller
//! @module mcp_server::health

use crate::command_error::CommandError;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{command, AppHandle};
use tauri_plugin_shell::process::CommandEvent;
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

/// How long the sidecar may take to answer `--health-check`: it prints one
/// JSON line and exits, so anything longer is a wedged child (#395).
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// Most bytes kept from either sidecar stream — the reply is a few hundred
/// bytes of JSON, and `output()` kept every line a child chose to write.
const HEALTH_CHECK_MAX_BYTES: usize = 256 * 1024;

/// What the sidecar said before it exited, or why nothing usable arrived.
struct HealthOutput {
    ok: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// Drain the sidecar's events until it terminates, keeping at most
/// `HEALTH_CHECK_MAX_BYTES` of either stream.
async fn collect_health(rx: &mut tauri::async_runtime::Receiver<CommandEvent>) -> HealthOutput {
    let mut out = HealthOutput {
        ok: false,
        stdout: Vec::new(),
        stderr: Vec::new(),
    };
    let keep = |buf: &mut Vec<u8>, line: Vec<u8>| {
        if buf.len() < HEALTH_CHECK_MAX_BYTES {
            buf.extend(line);
            buf.push(b'\n');
        }
    };
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => keep(&mut out.stdout, line),
            CommandEvent::Stderr(line) => keep(&mut out.stderr, line),
            CommandEvent::Terminated(payload) => out.ok = payload.code == Some(0),
            _ => {}
        }
    }
    out
}

/// Run MCP sidecar health check.
/// This runs the sidecar binary with --health-check flag to get real tool/version info.
///
/// Bounded, and the child is KILLED when the bound elapses (#395): `output()`
/// waits forever and keeps whatever the child writes. A timeout that only
/// dropped that future would leave the process running, which is why the
/// pipes are drained by hand.
#[command]
pub async fn mcp_sidecar_health(app: AppHandle) -> Result<McpHealthInfo, CommandError> {
    let shell = app.shell();

    // Run sidecar with --health-check flag
    let (mut rx, child) = shell
        .sidecar("vmark-mcp-server")
        .map_err(|e| CommandError::io(format!("Failed to create sidecar command: {}", e)))?
        .args(["--health-check"])
        .spawn()
        .map_err(|e| CommandError::io(format!("Failed to run health check: {}", e)))?;

    let Ok(output) = tokio::time::timeout(HEALTH_CHECK_TIMEOUT, collect_health(&mut rx)).await
    else {
        let _ = child.kill();
        return Err(CommandError::timeout(format!(
            "MCP sidecar did not answer --health-check within {}s",
            HEALTH_CHECK_TIMEOUT.as_secs()
        )));
    };
    // The child has terminated; this only releases the handle.
    drop(child);

    if output.ok {
        // Parse JSON output from sidecar
        let result: McpHealthInfo = serde_json::from_slice(&output.stdout).map_err(|e| {
            CommandError::internal(format!("Failed to parse health check output: {}", e))
        })?;
        Ok(result)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(CommandError::io(format!("Health check failed: {}", stderr)))
    }
}
