//! Tauri commands for MCP configuration management.
//!
//! Provides commands for checking provider status, previewing changes,
//! installing, uninstalling, and diagnosing MCP configurations.

use super::backup_io::generate_backup_path;
use super::client_tokens::{self, TokenPolicy};
use super::config_io::{generate_config_content, read_existing_config, ExistingConfig};
use super::install_io::{install_config_at, read_config_for_merge, uninstall_config_at};
use super::providers::{
    get_config_path, get_mcp_binary_path, get_provider_config, ProviderConfig, PROVIDERS,
};
use super::types::{
    ConfigPreview, DiagnosticStatus, InstallResult, ProviderDiagnostic, UninstallResult,
};
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use std::path::{Path, PathBuf};

/// Do two binary paths name the same file? Canonicalizes where it can, so a
/// symlinked or `..`-laden path does not read as a mismatch.
fn same_binary(a: &str, b: &str) -> bool {
    let resolve = |p: &str| {
        Path::new(p)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(p))
    };
    resolve(a) == resolve(b)
}

/// Classify one provider's config into the diagnostic the settings panel gets.
///
/// Pure with respect to the config: everything read from disk arrives as
/// `existing`, so the status mapping is testable without a real `$HOME`.
/// (`binary_exists` is still a live `Path::exists` — the configured binary is
/// exactly the thing whose presence we are asserting.)
fn build_diagnostic(
    provider: &ProviderConfig,
    config_path: &Path,
    existing: ExistingConfig,
    expected_binary_path: Option<&str>,
) -> ProviderDiagnostic {
    // A config we cannot parse is reported as such and nothing more: its
    // vmark entry, and therefore every path check below, is unknowable.
    let (config_exists, has_vmark, configured_binary_path, unreadable) = match existing {
        ExistingConfig::Absent => (false, false, None, None),
        ExistingConfig::Parsed {
            has_vmark,
            binary_path,
        } => (true, has_vmark, binary_path, None),
        ExistingConfig::Unreadable { detail } => (true, false, None, Some(detail)),
    };

    let binary_exists = configured_binary_path
        .as_deref()
        .map(|p| Path::new(p).exists())
        .unwrap_or(false);

    let (status, message) = match (unreadable, has_vmark, binary_exists) {
        (Some(detail), ..) => (DiagnosticStatus::ConfigUnreadable, detail),
        (None, false, _) => (DiagnosticStatus::NotConfigured, String::new()),
        (None, true, false) => (
            DiagnosticStatus::BinaryMissing,
            "Binary not found - reinstall VMark".to_string(),
        ),
        (None, true, true) => match (expected_binary_path, configured_binary_path.as_deref()) {
            // No expected path (development builds) but the configured binary
            // is really there: nothing to contradict, so treat it as valid.
            (None, _) => (DiagnosticStatus::Valid, String::new()),
            (Some(expected), Some(configured)) if same_binary(expected, configured) => {
                (DiagnosticStatus::Valid, String::new())
            }
            _ => (
                DiagnosticStatus::PathMismatch,
                "Binary path outdated - click Repair".to_string(),
            ),
        },
    };

    ProviderDiagnostic {
        provider: provider.id.to_string(),
        name: provider.name.to_string(),
        legacy: provider.legacy,
        config_path: config_path.to_string_lossy().to_string(),
        config_exists,
        has_vmark,
        expected_binary_path: expected_binary_path.map(str::to_string),
        configured_binary_path,
        binary_exists,
        status,
        message,
    }
}

/// Whether a provider belongs in the Integrations panel at all.
///
/// A legacy provider (a tool VMark no longer targets) earns a row only while
/// its config still holds a vmark entry to remove. Absent, unconfigured and
/// unreadable configs are all skipped: there is nothing a discontinued tool's
/// row could offer for them, and an Install button would write into a config
/// nothing reads anymore.
fn should_list(provider: &ProviderConfig, existing: &ExistingConfig) -> bool {
    !provider.legacy
        || matches!(
            existing,
            ExistingConfig::Parsed {
                has_vmark: true,
                ..
            }
        )
}

/// Refuse config-writing commands for a legacy provider.
///
/// The panel never offers Install or Preview for one, so reaching this is a
/// caller bug or a stale UI — either way the config of a discontinued tool
/// must not gain a fresh vmark entry.
fn require_active(config: &ProviderConfig) -> Result<(), CommandError> {
    if config.legacy {
        // The panel never offers Install or Preview for a legacy provider, so
        // reaching this means the caller asked for something the UI does not
        // expose — bad input, not a VMark fault.
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.mcp.legacyProvider",
            name = config.name
        ));
    }
    Ok(())
}

/// Diagnose MCP configuration for all AI providers
/// Returns detailed diagnostics including path validation
#[tauri::command]
pub fn mcp_config_diagnose() -> Result<Vec<ProviderDiagnostic>, CommandError> {
    let mut diagnostics = Vec::new();

    // Get the expected binary path once (may fail if binary not found)
    let expected_binary_path = get_mcp_binary_path().ok();

    for provider in PROVIDERS {
        let path = get_config_path(provider)?;
        // `config_exists` comes out of this read rather than a separate
        // `path.exists()` stat, so it cannot disagree with what was read.
        let existing = read_existing_config(&path, provider.id).map_err(CommandError::io)?;
        if !should_list(provider, &existing) {
            continue;
        }
        diagnostics.push(build_diagnostic(
            provider,
            &path,
            existing,
            expected_binary_path.as_deref(),
        ));
    }

    Ok(diagnostics)
}

/// Preview config changes before installation.
///
/// A config we cannot read or parse surfaces here as an error, so the user is
/// told to fix or move the file *before* the install path touches it.
///
/// The proposed content shows the credential already configured, or a
/// placeholder when the install will mint one — see
/// `client_token_field::TOKEN_PLACEHOLDER`.
#[tauri::command]
pub fn mcp_config_preview(provider: String) -> Result<ConfigPreview, CommandError> {
    let config = get_provider_config(&provider)?;
    require_active(config)?;
    let path = get_config_path(config)?;
    let binary_path = get_mcp_binary_path()?;

    let current_content = read_config_for_merge(&path).map_err(CommandError::io)?;
    let client_token = client_tokens::preview_token(config.id, current_content.as_deref());

    let proposed_content = generate_config_content(
        config.id,
        &binary_path,
        &client_token,
        current_content.as_deref(),
    )
    .map_err(CommandError::io)?;

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

/// Install MCP configuration for a provider.
///
/// Delegates to `install_config_at`, which validates and merges before it
/// touches the filesystem: a malformed config aborts with the user's file
/// intact rather than being rewritten as a vmark-only one.
///
/// Also issues (or preserves) the per-client credential the bridge binds its
/// authorization principal to, and republishes the registry so an install done
/// while VMark is running takes effect without a restart. The *client* still
/// has to restart — MCP servers read their `env` when the client spawns them.
#[tauri::command]
pub fn mcp_config_install(provider: String) -> Result<InstallResult, CommandError> {
    let config = get_provider_config(&provider)?;
    require_active(config)?;
    let path = get_config_path(config)?;
    let binary_path = get_mcp_binary_path()?;

    let backup_path = install_config_at(
        &path,
        config.id,
        &binary_path,
        &TokenPolicy::for_provider(config.id),
    )
    .map_err(CommandError::io)?;
    client_tokens::refresh();

    Ok(InstallResult {
        success: true,
        message: format!(
            "Successfully installed MCP configuration for {}",
            config.name
        ),
        backup_path,
    })
}

/// Uninstall MCP configuration for a provider.
///
/// Shares `mutate_config_at` with the install path, so a malformed config
/// aborts before any file — including the backup — is written, and a config
/// with no vmark entry is left byte-for-byte alone rather than reformatted.
///
/// Removing the entry removes its credential, so the registry is republished:
/// a sidecar still running with the removed credential connects (the shared
/// bridge token is what authenticates it) but is no longer identified.
#[tauri::command]
pub fn mcp_config_uninstall(provider: String) -> Result<UninstallResult, CommandError> {
    let config = get_provider_config(&provider)?;
    let path = get_config_path(config)?;

    let mutation = uninstall_config_at(&path, config.id).map_err(CommandError::io)?;
    client_tokens::refresh();

    Ok(UninstallResult {
        success: true,
        changed: mutation.changed,
        message: if mutation.changed {
            format!(
                "Successfully removed VMark from {} configuration",
                config.name
            )
        } else {
            format!(
                "VMark was not configured for {}; nothing to remove",
                config.name
            )
        },
    })
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
