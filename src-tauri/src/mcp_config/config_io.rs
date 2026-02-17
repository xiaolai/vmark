//! Config file I/O — reading, writing, generating, and removing MCP entries.
//!
//! Handles the JSON (Claude Desktop, Claude Code, Gemini) and TOML (Codex)
//! config formats for adding/removing the vmark MCP server entry.

use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};

/// Read existing config and check if it has vmark entry
pub(crate) fn read_existing_config(path: &PathBuf, provider_id: &str) -> (Option<String>, bool) {
    let content = fs::read_to_string(path).ok();
    let has_vmark = if let Some(ref c) = content {
        match provider_id {
            "claude-desktop" | "claude" | "gemini" => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(c) {
                    json.get("mcpServers")
                        .and_then(|s| s.get("vmark"))
                        .is_some()
                } else {
                    false
                }
            }
            "codex" => {
                if let Ok(toml) = c.parse::<toml::Table>() {
                    toml.get("mcp_servers")
                        .and_then(|s| s.get("vmark"))
                        .is_some()
                } else {
                    false
                }
            }
            _ => false,
        }
    } else {
        false
    };
    (content, has_vmark)
}

/// Extract the vmark binary path from config content
pub(crate) fn extract_vmark_binary_path(content: &str, provider_id: &str) -> Option<String> {
    match provider_id {
        "claude-desktop" | "claude" | "gemini" => {
            // JSON format: mcpServers.vmark.command
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
                json.get("mcpServers")
                    .and_then(|s| s.get("vmark"))
                    .and_then(|v| v.get("command"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        }
        "codex" => {
            // TOML format: mcp_servers.vmark.command
            if let Ok(toml) = content.parse::<toml::Table>() {
                toml.get("mcp_servers")
                    .and_then(|s| s.get("vmark"))
                    .and_then(|v| v.get("command"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Generate proposed config content for a provider.
/// Note: No --port argument needed - sidecar auto-discovers port from app data directory
pub(crate) fn generate_config_content(
    provider_id: &str,
    binary_path: &str,
    existing_content: Option<&str>,
) -> Result<String, String> {
    match provider_id {
        "claude-desktop" | "claude" | "gemini" => {
            let mut json: serde_json::Value = existing_content
                .and_then(|c| serde_json::from_str(c).ok())
                .unwrap_or_else(|| serde_json::json!({}));

            let mcp_servers = json
                .as_object_mut()
                .ok_or("Invalid JSON structure")?
                .entry("mcpServers")
                .or_insert_with(|| serde_json::json!({}));

            // No args needed - sidecar auto-discovers port from app data directory
            mcp_servers
                .as_object_mut()
                .ok_or("mcpServers is not an object")?
                .insert(
                    "vmark".to_string(),
                    serde_json::json!({
                        "command": binary_path
                    }),
                );

            serde_json::to_string_pretty(&json).map_err(|e| format!("JSON serialization error: {}", e))
        }
        "codex" => {
            let mut toml_doc: toml::Table = existing_content
                .and_then(|c| c.parse().ok())
                .unwrap_or_default();

            let mcp_servers = toml_doc
                .entry("mcp_servers")
                .or_insert_with(|| toml::Value::Table(toml::Table::new()));

            if let toml::Value::Table(servers) = mcp_servers {
                // No args needed - sidecar auto-discovers port from app data directory
                let mut vmark_config = toml::Table::new();
                vmark_config.insert("command".to_string(), toml::Value::String(binary_path.to_string()));
                servers.insert("vmark".to_string(), toml::Value::Table(vmark_config));
            }

            toml::to_string_pretty(&toml_doc).map_err(|e| format!("TOML serialization error: {}", e))
        }
        _ => Err(format!("Unknown provider: {}", provider_id)),
    }
}

/// Remove vmark entry from config
pub(crate) fn remove_vmark_from_config(provider_id: &str, content: &str) -> Result<String, String> {
    match provider_id {
        "claude-desktop" | "claude" | "gemini" => {
            let mut json: serde_json::Value =
                serde_json::from_str(content).map_err(|e| format!("Invalid JSON: {}", e))?;

            if let Some(servers) = json.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
                servers.remove("vmark");
            }

            serde_json::to_string_pretty(&json).map_err(|e| format!("JSON serialization error: {}", e))
        }
        "codex" => {
            let mut toml_doc: toml::Table =
                content.parse().map_err(|e| format!("Invalid TOML: {}", e))?;

            if let Some(toml::Value::Table(servers)) = toml_doc.get_mut("mcp_servers") {
                servers.remove("vmark");
            }

            toml::to_string_pretty(&toml_doc).map_err(|e| format!("TOML serialization error: {}", e))
        }
        _ => Err(format!("Unknown provider: {}", provider_id)),
    }
}

pub(crate) fn generate_backup_path(config_path: &Path) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let file_name = config_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    config_path.with_file_name(format!("{}.backup.{}", file_name, timestamp))
}
