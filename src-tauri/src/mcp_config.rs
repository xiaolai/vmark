//! MCP Configuration Installer
//!
//! Handles installation of MCP configuration for AI providers:
//! - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
//! - Claude Code: ~/.claude.json
//! - Codex CLI: ~/.codex/config.toml
//! - Gemini CLI: ~/.gemini/settings.json

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Status of a single AI provider configuration
#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub provider: String,
    pub name: String,
    pub path: String,
    pub exists: bool,
    #[serde(rename = "hasVmark")]
    pub has_vmark: bool,
}

/// Preview of config changes before installation
#[derive(Clone, Serialize, Deserialize)]
pub struct ConfigPreview {
    pub provider: String,
    pub path: String,
    #[serde(rename = "binaryPath")]
    pub binary_path: String,
    #[serde(rename = "isDev")]
    pub is_dev: bool,
    #[serde(rename = "currentContent")]
    pub current_content: Option<String>,
    #[serde(rename = "proposedContent")]
    pub proposed_content: String,
    #[serde(rename = "backupPath")]
    pub backup_path: String,
}

/// Result of config installation
#[derive(Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
    #[serde(rename = "backupPath")]
    pub backup_path: Option<String>,
}

/// Result of config uninstallation
#[derive(Clone, Serialize, Deserialize)]
pub struct UninstallResult {
    pub success: bool,
    pub message: String,
}

/// Provider configuration details
struct ProviderConfig {
    name: &'static str,
    id: &'static str,
    relative_path: &'static str,
}

const PROVIDERS: &[ProviderConfig] = &[
    ProviderConfig {
        name: "Claude Desktop",
        id: "claude-desktop",
        relative_path: "Library/Application Support/Claude/claude_desktop_config.json",
    },
    ProviderConfig {
        name: "Claude Code",
        id: "claude",
        relative_path: ".claude.json",
    },
    ProviderConfig {
        name: "Codex CLI",
        id: "codex",
        relative_path: ".codex/config.toml",
    },
    ProviderConfig {
        name: "Gemini CLI",
        id: "gemini",
        relative_path: ".gemini/settings.json",
    },
];

fn get_provider_config(provider: &str) -> Result<&'static ProviderConfig, String> {
    PROVIDERS
        .iter()
        .find(|p| p.id == provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))
}

fn get_config_path(provider: &ProviderConfig) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(provider.relative_path))
}

fn get_target_triple() -> &'static str {
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "windows"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(not(any(
        all(target_arch = "aarch64", target_os = "macos"),
        all(target_arch = "x86_64", target_os = "macos"),
        all(target_arch = "x86_64", target_os = "linux"),
        all(target_arch = "x86_64", target_os = "windows"),
    )))]
    {
        "unknown-target"
    }
}

fn get_mcp_binary_path() -> Result<String, String> {
    let binary_name_with_target = format!("vmark-mcp-server-{}", get_target_triple());
    let binary_name_simple = "vmark-mcp-server";

    if cfg!(debug_assertions) {
        // Dev: src-tauri/binaries/vmark-mcp-server-{target}
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let dev_path = PathBuf::from(manifest_dir)
            .join("binaries")
            .join(&binary_name_with_target);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
        // Fallback: try current exe location
    }

    // Production: next to main executable
    let exe = std::env::current_exe().map_err(|e| format!("Cannot get executable path: {}", e))?;
    let exe_dir = exe.parent().ok_or("Cannot get executable directory")?;

    // On macOS, check MacOS folder first (where Tauri puts sidecars)
    #[cfg(target_os = "macos")]
    {
        // Try simple name first (Tauri bundles without target suffix)
        let macos_path = exe_dir.join(binary_name_simple);
        if macos_path.exists() {
            return Ok(macos_path
                .canonicalize()
                .unwrap_or(macos_path)
                .to_string_lossy()
                .to_string());
        }

        // Try Resources folder (alternative location)
        let resources_path = exe_dir.join("../Resources").join(&binary_name_with_target);
        if resources_path.exists() {
            return Ok(resources_path
                .canonicalize()
                .unwrap_or(resources_path)
                .to_string_lossy()
                .to_string());
        }
    }

    // Try next to executable with target suffix
    let prod_path = exe_dir.join(&binary_name_with_target);
    if prod_path.exists() {
        return Ok(prod_path.to_string_lossy().to_string());
    }

    Err(format!(
        "MCP server binary not found: {}. Please reinstall VMark.",
        binary_name_simple
    ))
}

/// Read existing config and check if it has vmark entry
fn read_existing_config(path: &PathBuf, provider_id: &str) -> (Option<String>, bool) {
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

/// Generate proposed config content for a provider.
/// Note: No --port argument needed - sidecar auto-discovers port from ~/.vmark/mcp-port
fn generate_config_content(
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

            // No args needed - sidecar auto-discovers port from ~/.vmark/mcp-port
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
                // No args needed - sidecar auto-discovers port from ~/.vmark/mcp-port
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
fn remove_vmark_from_config(provider_id: &str, content: &str) -> Result<String, String> {
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

fn generate_backup_path(config_path: &PathBuf) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let file_name = config_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    config_path.with_file_name(format!("{}.backup.{}", file_name, timestamp))
}

/// Get status of all AI providers
#[tauri::command]
pub fn mcp_config_get_status() -> Result<Vec<ProviderStatus>, String> {
    let mut statuses = Vec::new();

    for provider in PROVIDERS {
        let path = get_config_path(provider)?;
        let exists = path.exists();
        let has_vmark = if exists {
            read_existing_config(&path, provider.id).1
        } else {
            false
        };

        statuses.push(ProviderStatus {
            provider: provider.id.to_string(),
            name: provider.name.to_string(),
            path: path.to_string_lossy().to_string(),
            exists,
            has_vmark,
        });
    }

    Ok(statuses)
}

/// Preview config changes before installation
#[tauri::command]
pub fn mcp_config_preview(provider: String) -> Result<ConfigPreview, String> {
    let config = get_provider_config(&provider)?;
    let path = get_config_path(config)?;
    let binary_path = get_mcp_binary_path()?;

    let current_content = if path.exists() {
        read_existing_config(&path, config.id).0
    } else {
        None
    };

    let proposed_content =
        generate_config_content(config.id, &binary_path, current_content.as_deref())?;

    let backup_path = generate_backup_path(&path);

    Ok(ConfigPreview {
        provider: provider.clone(),
        path: path.to_string_lossy().to_string(),
        binary_path,
        is_dev: cfg!(debug_assertions),
        current_content,
        proposed_content,
        backup_path: backup_path.to_string_lossy().to_string(),
    })
}

/// Install MCP configuration for a provider
#[tauri::command]
pub fn mcp_config_install(provider: String) -> Result<InstallResult, String> {
    let config = get_provider_config(&provider)?;
    let path = get_config_path(config)?;
    let binary_path = get_mcp_binary_path()?;

    // Create parent directory if needed
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
        }
    }

    // Read existing content and create backup if file exists
    let backup_path = if path.exists() {
        let backup = generate_backup_path(&path);
        fs::copy(&path, &backup).map_err(|e| format!("Failed to create backup: {}", e))?;
        Some(backup.to_string_lossy().to_string())
    } else {
        None
    };

    // Read current content for merging
    let current_content = fs::read_to_string(&path).ok();

    // Generate new content
    let new_content =
        generate_config_content(config.id, &binary_path, current_content.as_deref())?;

    // Write to temp file first (atomic write)
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, &new_content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    // Rename temp to final (atomic on most filesystems)
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize config: {}", e))?;

    // Validate by re-reading
    let validation = fs::read_to_string(&path).ok();
    if validation.as_ref() != Some(&new_content) {
        return Err("Config validation failed: written content does not match".to_string());
    }

    Ok(InstallResult {
        success: true,
        message: format!(
            "Successfully installed MCP configuration for {}",
            config.name
        ),
        backup_path,
    })
}

/// Uninstall MCP configuration for a provider
#[tauri::command]
pub fn mcp_config_uninstall(provider: String) -> Result<UninstallResult, String> {
    let config = get_provider_config(&provider)?;
    let path = get_config_path(config)?;

    if !path.exists() {
        return Ok(UninstallResult {
            success: true,
            message: "Config file does not exist, nothing to uninstall".to_string(),
        });
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;

    // Create backup before modifying
    let backup = generate_backup_path(&path);
    fs::copy(&path, &backup).map_err(|e| format!("Failed to create backup: {}", e))?;

    // Remove vmark entry
    let new_content = remove_vmark_from_config(config.id, &content)?;

    // Write updated content
    fs::write(&path, &new_content).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(UninstallResult {
        success: true,
        message: format!(
            "Successfully removed VMark from {} configuration",
            config.name
        ),
    })
}
