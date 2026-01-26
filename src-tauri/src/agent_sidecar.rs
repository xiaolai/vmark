//! Agent Sidecar Process Management
//!
//! Manages the vmark-agent-sdk sidecar process that communicates with Claude Agent SDK.
//!
//! Architecture:
//! - Sidecar is a Node.js binary (built with pkg) that runs Agent SDK queries
//! - Communication via JSON lines over stdin/stdout
//! - Authentication priority: keychain API key > env ANTHROPIC_API_KEY > env CLAUDE_CODE_OAUTH_TOKEN
//! - Sidecar requires Claude Code CLI to be installed globally

use crate::api_key;
use crate::claude_detection;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Active sidecar process
static AGENT_SIDECAR: Mutex<Option<AgentProcess>> = Mutex::new(None);

/// Sidecar running state
static SIDECAR_RUNNING: AtomicBool = AtomicBool::new(false);

/// Wrapper for the sidecar process with stdin access
struct AgentProcess {
    child: CommandChild,
}

/// Agent request sent to the sidecar
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    #[serde(rename = "type")]
    pub request_type: String,
    pub id: String,
    pub prompt: Option<String>,
    pub options: Option<AgentOptions>,
}

/// Options for agent queries
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentOptions {
    pub max_turns: Option<u32>,
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
}

/// Agent response from the sidecar (emitted as event)
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentResponse {
    #[serde(rename = "type")]
    pub response_type: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    // For claude_status response
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Agent sidecar status
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AgentStatus {
    pub running: bool,
    pub claude_installed: bool,
    pub claude_version: Option<String>,
    pub has_api_key: bool,
}

/// Start the agent sidecar process
#[command]
pub async fn agent_start(app: AppHandle) -> Result<AgentStatus, String> {
    // Check if already running
    if SIDECAR_RUNNING.load(Ordering::SeqCst) {
        return agent_status().await;
    }

    // Check Claude Code is installed
    let claude_status = claude_detection::detect_claude_code().await?;
    if !claude_status.installed {
        return Err(
            "Claude Code is not installed. Please install it from https://claude.ai/code"
                .to_string(),
        );
    }

    // Get API key with fallback chain:
    // 1. Keychain (explicit user-configured key)
    // 2. Environment ANTHROPIC_API_KEY (inherited from parent process)
    // 3. Environment CLAUDE_CODE_OAUTH_TOKEN (Claude Pro/Max subscription)
    let keychain_key = api_key::get_api_key().await.ok().flatten();
    let env_api_key = std::env::var("ANTHROPIC_API_KEY").ok();
    let env_oauth_token = std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok();

    // Spawn the sidecar process
    let shell = app.shell();
    let mut sidecar_cmd = shell
        .sidecar("vmark-agent-sdk")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    // Inject authentication credentials in priority order
    if let Some(key) = keychain_key {
        // Priority 1: User-configured key from keychain
        sidecar_cmd = sidecar_cmd.env("ANTHROPIC_API_KEY", key);
    } else if let Some(key) = env_api_key {
        // Priority 2: API key from parent environment
        sidecar_cmd = sidecar_cmd.env("ANTHROPIC_API_KEY", key);
    } else if let Some(token) = env_oauth_token {
        // Priority 3: OAuth token from Claude Pro/Max subscription
        sidecar_cmd = sidecar_cmd.env("CLAUDE_CODE_OAUTH_TOKEN", token);
    }

    let (mut rx, child) = sidecar_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn agent sidecar: {}", e))?;

    // Store the child process
    {
        let mut guard = AGENT_SIDECAR.lock().map_err(|e| e.to_string())?;
        *guard = Some(AgentProcess { child });
    }

    SIDECAR_RUNNING.store(true, Ordering::SeqCst);

    // Spawn a task to monitor the process output and emit events
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    #[cfg(debug_assertions)]
                    eprintln!("[Agent SDK] stdout: {}", line_str);

                    // Parse JSON response and emit event
                    if let Ok(response) = serde_json::from_str::<AgentResponse>(&line_str) {
                        let _ = app_handle.emit("agent:response", &response);
                    }
                }
                CommandEvent::Stderr(_line) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[Agent SDK] stderr: {}", String::from_utf8_lossy(&_line));
                }
                CommandEvent::Terminated(_payload) => {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[Agent SDK] Process terminated with code: {:?}",
                        _payload.code
                    );

                    // Clear the stored process and mark as stopped
                    if let Ok(mut guard) = AGENT_SIDECAR.lock() {
                        *guard = None;
                    }
                    SIDECAR_RUNNING.store(false, Ordering::SeqCst);

                    // Emit stopped event
                    let _ = app_handle.emit("agent:stopped", ());

                    break;
                }
                _ => {}
            }
        }
    });

    // Emit started event
    let _ = app.emit("agent:started", ());

    agent_status().await
}

/// Stop the agent sidecar process
#[command]
pub async fn agent_stop() -> Result<AgentStatus, String> {
    {
        let mut guard = AGENT_SIDECAR.lock().map_err(|e| e.to_string())?;
        if let Some(process) = guard.take() {
            let _ = process.child.kill();
        }
    }

    SIDECAR_RUNNING.store(false, Ordering::SeqCst);

    agent_status().await
}

/// Send a query to the agent sidecar
#[command]
pub async fn agent_query(app: AppHandle, request: AgentRequest) -> Result<(), String> {
    // Ensure sidecar is running
    if !SIDECAR_RUNNING.load(Ordering::SeqCst) {
        // Auto-start sidecar if not running
        agent_start(app.clone()).await?;
    }

    // Get the process and write to stdin
    let mut guard = AGENT_SIDECAR.lock().map_err(|e| e.to_string())?;
    let process = guard
        .as_mut()
        .ok_or("Agent sidecar not running")?;

    // Serialize request to JSON line
    let json_line = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;

    // Write to stdin
    process
        .child
        .write((json_line + "\n").as_bytes())
        .map_err(|e| format!("Failed to write to sidecar: {}", e))?;

    Ok(())
}

/// Get the current agent sidecar status
#[command]
pub async fn agent_status() -> Result<AgentStatus, String> {
    let running = SIDECAR_RUNNING.load(Ordering::SeqCst);
    let claude_status = claude_detection::detect_claude_code().await?;

    // Check all authentication sources
    let has_keychain_key = api_key::has_api_key().await.unwrap_or(false);
    let has_env_api_key = std::env::var("ANTHROPIC_API_KEY").is_ok();
    let has_oauth_token = std::env::var("CLAUDE_CODE_OAUTH_TOKEN").is_ok();
    let has_key = has_keychain_key || has_env_api_key || has_oauth_token;

    Ok(AgentStatus {
        running,
        claude_installed: claude_status.installed,
        claude_version: claude_status.version,
        has_api_key: has_key,
    })
}

/// Cleanup function to kill the sidecar on app exit
pub fn cleanup() {
    if let Ok(mut guard) = AGENT_SIDECAR.lock() {
        if let Some(process) = guard.take() {
            let _ = process.child.kill();
        }
    }
    SIDECAR_RUNNING.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_request_serialization() {
        let request = AgentRequest {
            request_type: "query".to_string(),
            id: "test-1".to_string(),
            prompt: Some("Hello".to_string()),
            options: Some(AgentOptions {
                max_turns: Some(3),
                allowed_tools: Some(vec!["mcp__vmark__document_get_content".to_string()]),
                model: None,
                system_prompt: None,
            }),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"type\":\"query\""));
        assert!(json.contains("\"id\":\"test-1\""));
    }
}
