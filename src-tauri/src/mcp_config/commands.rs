//! Tauri commands for MCP configuration management.
//!
//! Provides commands for checking provider status, previewing changes,
//! installing, uninstalling, and diagnosing MCP configurations.

use super::config_io::{
    extract_vmark_binary_path, generate_backup_path, generate_config_content,
    read_existing_config, remove_vmark_from_config,
};
use super::providers::{get_config_path, get_mcp_binary_path, get_provider_config, PROVIDERS};
use super::types::{
    ConfigPreview, DiagnosticStatus, InstallResult, ProviderDiagnostic, ProviderStatus,
    UninstallResult,
};
use std::fs;

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

/// Diagnose MCP configuration for all AI providers
/// Returns detailed diagnostics including path validation
#[tauri::command]
pub fn mcp_config_diagnose() -> Result<Vec<ProviderDiagnostic>, String> {
    let mut diagnostics = Vec::new();

    // Get the expected binary path once (may fail if binary not found)
    let expected_binary_path = get_mcp_binary_path().ok();

    for provider in PROVIDERS {
        let path = get_config_path(provider)?;
        let config_exists = path.exists();
        let (content, has_vmark) = if config_exists {
            read_existing_config(&path, provider.id)
        } else {
            (None, false)
        };

        // Extract the configured binary path from the config file
        let configured_binary_path = content
            .as_ref()
            .and_then(|c| extract_vmark_binary_path(c, provider.id));

        // Check if the configured binary exists on disk
        let binary_exists = configured_binary_path
            .as_ref()
            .map(|p| std::path::Path::new(p).exists())
            .unwrap_or(false);

        // Determine diagnostic status and message
        let (status, message) = if !has_vmark {
            (DiagnosticStatus::NotConfigured, String::new())
        } else if !binary_exists {
            (
                DiagnosticStatus::BinaryMissing,
                "Binary not found - reinstall VMark".to_string(),
            )
        } else if let (Some(ref expected), Some(ref configured)) =
            (&expected_binary_path, &configured_binary_path)
        {
            // Compare paths - normalize for comparison
            let expected_canonical = std::path::Path::new(expected)
                .canonicalize()
                .unwrap_or_else(|_| std::path::PathBuf::from(expected));
            let configured_canonical = std::path::Path::new(configured)
                .canonicalize()
                .unwrap_or_else(|_| std::path::PathBuf::from(configured));

            if expected_canonical == configured_canonical {
                (DiagnosticStatus::Valid, String::new())
            } else {
                (
                    DiagnosticStatus::PathMismatch,
                    "Binary path outdated - click Repair".to_string(),
                )
            }
        } else if expected_binary_path.is_none() && binary_exists {
            // Expected path couldn't be determined, but configured binary exists
            // This could happen during development, treat as valid
            (DiagnosticStatus::Valid, String::new())
        } else {
            (
                DiagnosticStatus::PathMismatch,
                "Binary path outdated - click Repair".to_string(),
            )
        };

        diagnostics.push(ProviderDiagnostic {
            provider: provider.id.to_string(),
            name: provider.name.to_string(),
            config_path: path.to_string_lossy().to_string(),
            config_exists,
            has_vmark,
            expected_binary_path: expected_binary_path.clone(),
            configured_binary_path,
            binary_exists,
            status,
            message,
        });
    }

    Ok(diagnostics)
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

    // Atomic write (handles Windows rename-over-existing via platform-specific code)
    crate::app_paths::atomic_write_file(&path, new_content.as_bytes())?;

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

    // Atomic write (consistent with install path — prevents corruption on interrupted writes)
    crate::app_paths::atomic_write_file(&path, new_content.as_bytes())?;

    Ok(UninstallResult {
        success: true,
        message: format!(
            "Successfully removed VMark from {} configuration",
            config.name
        ),
    })
}
