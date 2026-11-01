//! # Workspace Configuration
//!
//! Purpose: Reads and writes per-workspace settings (exclude folders, hidden files,
//! last-open tabs, AI config, identity/trust) stored in `<appData>/workspaces/<hash>.json`.
//!
//! Pipeline: Frontend invoke("read_workspace_config") → this module → filesystem.
//! On first read, migrates from legacy `.vmark/` directory format if present.
//!
//! Key decisions:
//!   - Root paths are hashed (SHA-256, first 16 bytes) into deterministic filenames.
//!     Releases <= 0.7.22 used 8 bytes; those files are renamed forward on first read.
//!   - Legacy migration is one-shot and read-only: the new app-data config is
//!     written, and the repository's `.vmark/` tree is left exactly as found.
//!   - Writes use atomic_write_file to prevent partial reads by concurrent processes.
//!   - Both commands are `async` and do their disk work on the blocking pool,
//!     one at a time under `ConfigIoLock` (see there for the migration race the
//!     IPC thread used to prevent). Legacy layouts live in `workspace/legacy.rs`.
//!
//! Child modules: `root_hash` (config file names), `grants` (recursive folder grants), `transfer` (moving a
//! workspace between windows), `validation` (the MCP `open_workspace` path).
//!
//! Known limitations:
//!   - Hash collisions are possible in theory but vanishingly unlikely (2^64 space).

use crate::app_paths;
use crate::command_error::CommandError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub(crate) mod grants;
mod legacy;
mod root_hash;
pub(crate) mod transfer;
pub(crate) mod validation;
use legacy::{fallback_after_rename, migrate_from_legacy};
#[cfg(test)]
use legacy::{try_rename_legacy_hash, HashMigrationOutcome};
#[cfg(test)]
use root_hash::root_without_trailing_separators;
pub(crate) use root_hash::{hash_root_path, legacy_hash_root_path};

/// Workspace identity and trust information for permission management.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceIdentity {
    /// Unique identifier for this workspace (UUID v4)
    pub id: String,
    /// When this workspace was first created (unix timestamp ms)
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    /// Current trust level: "untrusted" or "trusted"
    #[serde(rename = "trustLevel")]
    pub trust_level: String,
    /// When trust was granted (null if untrusted)
    #[serde(rename = "trustedAt", skip_serializing_if = "Option::is_none")]
    pub trusted_at: Option<i64>,
}

/// Workspace configuration — the public API type.
/// Stored as `<app_data>/workspaces/<hash>.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub version: u32,
    #[serde(rename = "excludeFolders")]
    pub exclude_folders: Vec<String>,
    #[serde(rename = "showHiddenFiles", default)]
    pub show_hidden_files: bool,
    #[serde(rename = "lastOpenTabs")]
    pub last_open_tabs: Vec<String>,
    /// Versioned session-tab records (documents + browser tabs), kept
    /// as an opaque JSON value here: the schema and its migration live on the TS
    /// side (`services/persistence/sessionTabs.ts`). Additive and downgrade-safe:
    /// `lastOpenTabs` still carries document paths so an older binary keeps
    /// restoring documents and ignores this unknown field.
    #[serde(
        rename = "sessionTabs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub session_tabs: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<WorkspaceIdentity>,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            version: 1,
            exclude_folders: vec![".git".to_string(), "node_modules".to_string()],
            show_hidden_files: false,
            last_open_tabs: vec![],
            session_tabs: None,
            ai: None,
            identity: None,
        }
    }
}

// ============================================================================
// Path hashing
// ============================================================================

/// Get the workspaces directory inside app data.
fn get_workspaces_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(crate::app_paths::app_data_dir(app)?.join("workspaces"))
}

/// Get the path to a workspace config file in app data.
fn get_workspace_config_path(
    app: &tauri::AppHandle,
    root_path: &str,
) -> Result<std::path::PathBuf, String> {
    let ws_dir = get_workspaces_dir(app)?;
    let hash = hash_root_path(root_path);
    Ok(ws_dir.join(format!("{hash}.json")))
}

/// Get the legacy 16-hex-char workspace config path for migration only.
fn get_legacy_workspace_config_path(
    app: &tauri::AppHandle,
    root_path: &str,
) -> Result<std::path::PathBuf, String> {
    let ws_dir = get_workspaces_dir(app)?;
    let hash = legacy_hash_root_path(root_path);
    Ok(ws_dir.join(format!("{hash}.json")))
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Read + parse a config file. AppHandle-free so tests can drive it directly.
fn read_config_at(path: &Path) -> Result<WorkspaceConfig, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read config: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse workspace config: {e}"))
}

/// Serializes workspace-config I/O across commands and windows. The commands
/// are `async` so their disk work leaves the IPC thread, and that ends the
/// serialization the IPC thread used to give them: two windows opening one
/// workspace could both run the one-shot legacy migration, and the loser —
/// finding `.vmark/` already cleaned up — read "no config", after which its
/// next write put defaults over the migrated settings.
#[derive(Default)]
struct ConfigIoLock(std::sync::Mutex<()>);

/// Where one config operation reads and writes. Resolved before leaving the
/// IPC thread: path arithmetic only, no I/O.
struct ConfigPaths {
    ws_dir: PathBuf,
    ws_path: PathBuf,
    legacy_path: Option<PathBuf>,
}

fn config_paths(app: &tauri::AppHandle, root_path: &str) -> Result<ConfigPaths, CommandError> {
    Ok(ConfigPaths {
        ws_dir: get_workspaces_dir(app).map_err(CommandError::io)?,
        ws_path: get_workspace_config_path(app, root_path).map_err(CommandError::io)?,
        legacy_path: get_legacy_workspace_config_path(app, root_path).ok(),
    })
}

/// Run `work` on the blocking pool while holding the app's config lock.
async fn config_io<R, T, F>(app: tauri::AppHandle<R>, work: F) -> Result<T, CommandError>
where
    R: tauri::Runtime,
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        // Managed on first use: the lock is this module's own business.
        if app.try_state::<ConfigIoLock>().is_none() {
            app.manage(ConfigIoLock::default());
        }
        let lock = app.state::<ConfigIoLock>();
        let _serialized = lock
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        work()
    })
    .await
    .map_err(|e| CommandError::internal(format!("workspace config task failed: {e}")))?
    .map_err(CommandError::io)
}

/// Read workspace config from app data, with one-time migration from legacy `.vmark/`.
///
/// # Errors
/// `io` when the config cannot be read, parsed or migrated; `internal` when
/// the blocking task itself failed.
#[tauri::command]
pub async fn read_workspace_config(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<Option<WorkspaceConfig>, CommandError> {
    let paths = config_paths(&app, &root_path)?;
    config_io(app, move || read_config_in(&paths, &root_path)).await
}

/// The body of `read_workspace_config` (runs under the config lock).
fn read_config_in(paths: &ConfigPaths, root_path: &str) -> Result<Option<WorkspaceConfig>, String> {
    // Migrate from the previous 8-byte hash filename if present. A failed rename
    // hands back the legacy path so we still read the user's real state.
    let legacy_fallback = paths
        .legacy_path
        .clone()
        .and_then(|legacy| fallback_after_rename(legacy, &paths.ws_path));

    if paths.ws_path.exists() {
        return Ok(Some(read_config_at(&paths.ws_path)?));
    }
    if let Some(legacy) = legacy_fallback {
        return Ok(Some(read_config_at(&legacy)?));
    }

    // Try migrate from legacy locations
    let Some(config) = migrate_from_legacy(root_path)? else {
        return Ok(None);
    };
    fs::create_dir_all(&paths.ws_dir)
        .map_err(|e| format!("Failed to create workspaces dir: {e}"))?;
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    // The legacy `.vmark/` tree belongs to the repository (often to git) and is
    // never deleted or rewritten. Once this write lands, the app-data config is
    // the source of truth and the next read short-circuits before migration.
    if let Err(e) = app_paths::atomic_write_file(&paths.ws_path, content.as_bytes()) {
        log::warn!("[workspace] migrated config not persisted ({e}); migration will re-run");
    }
    Ok(Some(config))
}

/// Write workspace config to `<app_data>/workspaces/<hash>.json`.
///
/// # Errors
/// `io` when the config cannot be written; `internal` when the blocking task
/// itself failed.
#[tauri::command]
pub async fn write_workspace_config(
    app: tauri::AppHandle,
    root_path: String,
    config: WorkspaceConfig,
) -> Result<(), CommandError> {
    let paths = config_paths(&app, &root_path)?;
    config_io(app, move || write_config_in(&paths, &config)).await
}

/// The body of `write_workspace_config` (runs under the config lock).
fn write_config_in(paths: &ConfigPaths, config: &WorkspaceConfig) -> Result<(), String> {
    fs::create_dir_all(&paths.ws_dir)
        .map_err(|e| format!("Failed to create workspaces dir: {e}"))?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    app_paths::atomic_write_file(&paths.ws_path, content.as_bytes())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;

#[cfg(test)]
#[path = "io.test.rs"]
mod io_tests;
