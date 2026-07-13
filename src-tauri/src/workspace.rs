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
//!   - Legacy migration is one-shot: after writing to the new location, the old `.vmark/`
//!     directory is cleaned up (best-effort).
//!   - Writes use atomic_write_file to prevent partial reads by concurrent processes.
//!
//! Known limitations:
//!   - Hash collisions are possible in theory but vanishingly unlikely (2^64 space).

use crate::app_paths;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

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
    /// WI-1.1 — versioned session-tab records (documents + browser tabs), kept
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

/// Truncated SHA-256 of a workspace root path, hex-encoded, for use as a filename.
/// The normalization is deliberately NOT "tidied up": these hashes ARE filenames on
/// disk, so changing it silently orphans every existing user's config. Frozen.
fn hash_root_path_bytes(root_path: &str, n: usize) -> String {
    let normalized = root_path.trim_end_matches('/').trim_end_matches('\\');
    let hash = Sha256::digest(normalized.as_bytes());
    hash.iter().take(n).map(|b| format!("{:02x}", b)).collect()
}

/// Current filename hash: 16 bytes (128 bits) → 2^64 collision space at the
/// birthday bound, vastly more than a user will ever accumulate.
fn hash_root_path(root_path: &str) -> String {
    hash_root_path_bytes(root_path, 16)
}

/// Legacy 8-byte hash used in releases <= 0.7.22 (2^32 birthday bound). Read-only:
/// `migrate_legacy_hash_filename` renames such a file to the 16-byte name on load.
fn legacy_hash_root_path(root_path: &str) -> String {
    hash_root_path_bytes(root_path, 8)
}

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

/// Outcome of a hash-filename migration. `RenameFailed` is load-bearing: the caller
/// must fall back to the legacy file rather than treat it as absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HashMigrationOutcome {
    /// New-layout file already exists; nothing to do.
    AlreadyMigrated,
    /// No legacy file present; nothing to do.
    NoLegacyFile,
    /// Renamed legacy → new successfully.
    Renamed,
    /// Tried to rename but the syscall failed; legacy file left in place.
    RenameFailed,
}

/// Pure-paths migration helper: if `legacy_path` exists and `new_path` does
/// not, rename one to the other. Split out from `migrate_legacy_hash_filename`
/// so unit tests can exercise every branch without a Tauri AppHandle.
fn try_rename_legacy_hash(
    legacy_path: &std::path::Path,
    new_path: &std::path::Path,
) -> HashMigrationOutcome {
    if new_path.exists() {
        return HashMigrationOutcome::AlreadyMigrated;
    }
    if !legacy_path.exists() {
        return HashMigrationOutcome::NoLegacyFile;
    }
    match fs::rename(legacy_path, new_path) {
        Ok(()) => {
            log::info!(
                "[workspace] migrated config to 16-byte hash: {} -> {}",
                legacy_path.display(),
                new_path.display()
            );
            HashMigrationOutcome::Renamed
        }
        Err(e) => {
            log::warn!(
                "[workspace] failed to migrate legacy config {}: {}",
                legacy_path.display(),
                e
            );
            HashMigrationOutcome::RenameFailed
        }
    }
}

/// Migrate the legacy-hash file to `new_path`, and hand back the legacy path ONLY when
/// the rename failed and the file is therefore still sitting there. The caller MUST read
/// from it: treating a failed rename as "no config" returns `None`, and the next write
/// then buries the user's excludes, tabs and identity/trust grant under a fresh default.
///
/// AppHandle-free so the fallback decision itself is unit-testable.
fn fallback_after_rename(legacy: PathBuf, new_path: &Path) -> Option<PathBuf> {
    match try_rename_legacy_hash(&legacy, new_path) {
        HashMigrationOutcome::RenameFailed => Some(legacy),
        _ => None,
    }
}

// ============================================================================
// Legacy migration types (kept private)
// ============================================================================

/// VS Code-compatible workspace file — legacy `.vmark/vmark.code-workspace`.
#[derive(Debug, Deserialize)]
struct LegacyWorkspaceFile {
    #[serde(default)]
    settings: LegacyWorkspaceSettings,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyWorkspaceSettings {
    #[serde(rename = "vmark.excludeFolders", default)]
    exclude_folders: Vec<String>,
    #[serde(rename = "vmark.showHiddenFiles", default)]
    show_hidden_files: bool,
    #[serde(rename = "vmark.lastOpenTabs", default)]
    last_open_tabs: Vec<String>,
    #[serde(rename = "vmark.ai", default)]
    ai: Option<serde_json::Value>,
    #[serde(rename = "vmark.identity", default)]
    identity: Option<WorkspaceIdentity>,
}

/// Ancient legacy workspace configuration (plain `.vmark` file).
#[derive(Debug, Deserialize)]
struct AncientLegacyConfig {
    #[serde(default)]
    version: u32,
    #[serde(rename = "excludeFolders", default)]
    exclude_folders: Vec<String>,
    #[serde(rename = "lastOpenTabs", default)]
    last_open_tabs: Vec<String>,
    #[serde(default)]
    ai: Option<serde_json::Value>,
}

// ============================================================================
// Legacy migration
// ============================================================================

/// Strip `.vmark` from a legacy exclude list — the directory no longer exists.
fn clean_excludes(folders: Vec<String>) -> Vec<String> {
    folders.into_iter().filter(|f| f != ".vmark").collect()
}

/// Try to read config from legacy `.vmark/` directory or ancient `.vmark` file.
/// Returns `Ok(Some(config))` if found, `Ok(None)` if no legacy exists. Both branches
/// spread `WorkspaceConfig::default()` and name only the fields the legacy format
/// carried, so a field added later cannot be migrated inconsistently between them.
fn migrate_from_legacy(root_path: &str) -> Result<Option<WorkspaceConfig>, String> {
    let root = Path::new(root_path);
    let dot_vmark = root.join(".vmark");

    // 1. Try .vmark/vmark.code-workspace (directory format)
    if dot_vmark.is_dir() {
        let ws_file_path = dot_vmark.join("vmark.code-workspace");
        if ws_file_path.exists() {
            let content = fs::read_to_string(&ws_file_path)
                .map_err(|e| format!("Failed to read legacy workspace file: {e}"))?;
            let ws: LegacyWorkspaceFile = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse legacy workspace file: {e}"))?;

            return Ok(Some(WorkspaceConfig {
                exclude_folders: clean_excludes(ws.settings.exclude_folders),
                show_hidden_files: ws.settings.show_hidden_files,
                last_open_tabs: ws.settings.last_open_tabs,
                ai: ws.settings.ai,
                identity: ws.settings.identity,
                ..WorkspaceConfig::default()
            }));
        }
    }

    // 2. Try .vmark as a plain file (ancient format)
    if dot_vmark.is_file() {
        let content = fs::read_to_string(&dot_vmark)
            .map_err(|e| format!("Failed to read ancient .vmark: {e}"))?;
        let ancient: AncientLegacyConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse ancient .vmark: {e}"))?;

        return Ok(Some(WorkspaceConfig {
            // A file predating the `version` key deserializes to 0 — a schema version
            // we never emitted. Clamp to the v1 it is, rather than persisting 0.
            version: ancient.version.max(1),
            exclude_folders: clean_excludes(ancient.exclude_folders),
            last_open_tabs: ancient.last_open_tabs,
            ai: ancient.ai,
            ..WorkspaceConfig::default()
        }));
    }

    Ok(None)
}

/// Best-effort cleanup of legacy `.vmark/` in a workspace root.
/// Removes workspace file, then tries to remove the directory (only if empty).
fn cleanup_old_vmark(root_path: &str) {
    let root = Path::new(root_path);
    let dot_vmark = root.join(".vmark");

    if dot_vmark.is_dir() {
        // Remove known file
        let _ = fs::remove_file(dot_vmark.join("vmark.code-workspace"));
        // Try rmdir (fails if not empty — that's fine)
        let _ = fs::remove_dir(&dot_vmark);
    } else if dot_vmark.is_file() {
        let _ = fs::remove_file(&dot_vmark);
    }
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Read + parse a config file. AppHandle-free so tests can drive it directly.
fn read_config_at(path: &Path) -> Result<WorkspaceConfig, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read config: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse workspace config: {e}"))
}

/// Read workspace config from app data, with one-time migration from legacy `.vmark/`.
#[tauri::command]
pub fn read_workspace_config(
    app: tauri::AppHandle,
    root_path: &str,
) -> Result<Option<WorkspaceConfig>, String> {
    let ws_path = get_workspace_config_path(&app, root_path)?;

    // Migrate from the previous 8-byte hash filename if present. A failed rename
    // hands back the legacy path so we still read the user's real state.
    let legacy_fallback = get_legacy_workspace_config_path(&app, root_path)
        .ok()
        .and_then(|legacy| fallback_after_rename(legacy, &ws_path));

    if ws_path.exists() {
        return Ok(Some(read_config_at(&ws_path)?));
    }
    if let Some(legacy) = legacy_fallback {
        return Ok(Some(read_config_at(&legacy)?));
    }

    // Try migrate from legacy locations
    if let Some(config) = migrate_from_legacy(root_path)? {
        let ws_dir = get_workspaces_dir(&app)?;
        fs::create_dir_all(&ws_dir).map_err(|e| format!("Failed to create workspaces dir: {e}"))?;
        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {e}"))?;

        // Only drop the old `.vmark/` once the new file is durably written; if it is
        // not, say so — silence here means the migration re-runs every launch unseen.
        match app_paths::atomic_write_file(&ws_path, content.as_bytes()) {
            Ok(()) => cleanup_old_vmark(root_path),
            Err(e) => log::warn!(
                "[workspace] migrated config not persisted ({e}); keeping legacy .vmark for retry"
            ),
        }

        return Ok(Some(config));
    }

    Ok(None)
}

/// Write workspace config to `<app_data>/workspaces/<hash>.json`.
#[tauri::command]
pub fn write_workspace_config(
    app: tauri::AppHandle,
    root_path: &str,
    config: WorkspaceConfig,
) -> Result<(), String> {
    let ws_path = get_workspace_config_path(&app, root_path)?;

    // Ensure parent directory exists
    if let Some(parent) = ws_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create workspaces dir: {e}"))?;
    }

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    app_paths::atomic_write_file(&ws_path, content.as_bytes())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "workspace.test.rs"]
mod tests;
