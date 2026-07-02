//! File snapshots for workflow undo.
//!
//! Before any workflow execution that modifies files, snapshot all affected
//! files. Snapshots preserve the full relative path from the workspace root
//! to prevent filename collisions between files in different directories.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_SNAPSHOTS: usize = 50;

/// Max accepted id length (a UUID is 36 chars; `snap-` + UUID is 41).
const MAX_ID_LEN: usize = 64;

/// Validate a caller-supplied execution/snapshot id before it is embedded in
/// a filesystem path. Only ASCII alphanumerics, `-` and `_` are allowed, so
/// path separators and `..` traversal are structurally impossible.
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err(format!("Invalid snapshot id length: {}", id.len()));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Invalid snapshot id: {:?}", id));
    }
    Ok(())
}

/// Metadata for a file snapshot.
#[derive(Debug, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub execution_id: String,
    pub timestamp: u64,
    pub files: Vec<String>,
    /// Files that did not exist before execution (should be deleted on restore).
    #[serde(default)]
    pub created_files: Vec<String>,
}

/// Create a snapshot of the given files before modification.
/// Files are stored using their relative path from the workspace root
/// to prevent collisions between same-named files in different directories.
pub async fn create_snapshot(
    app_data_dir: &Path,
    execution_id: &str,
    file_paths: &[PathBuf],
    workspace_root: &Path,
) -> Result<String, String> {
    validate_id(execution_id)?;
    let snapshot_id = format!("snap-{}", execution_id);
    let snapshot_dir = app_data_dir.join("workflow-snapshots").join(&snapshot_id);

    tokio::fs::create_dir_all(&snapshot_dir)
        .await
        .map_err(|e| format!("Failed to create snapshot directory: {}", e))?;

    // Canonical root for strip_prefix: validate_path returns canonicalized
    // paths (/private/tmp on macOS), which won't strip against a raw /tmp root.
    let canonical_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());

    let mut saved_files = Vec::new();
    let mut created_files = Vec::new();

    for path in file_paths {
        // Sandbox validation: same containment rules as workflow file actions
        // and restore_snapshot. Rejects traversal, absolute paths outside the
        // workspace, and symlink escapes.
        let path_str = path.to_string_lossy();
        let path = match super::sandbox::validate_path(&path_str, workspace_root) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Skipping snapshot of '{}' — {}", path_str, e);
                continue;
            }
        };

        if !path.exists() {
            // Track files that don't exist yet — they'll be created by the workflow
            // and should be deleted on restore
            created_files.push(path.to_string_lossy().to_string());
            continue;
        }

        // Use relative path from workspace root to preserve directory structure
        let Ok(relative) = path.strip_prefix(&canonical_root) else {
            log::warn!("Skipping snapshot of '{}' — outside workspace", path_str);
            continue;
        };
        let dest = snapshot_dir.join(relative);

        // Create parent directories in snapshot
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create snapshot subdirectory: {}", e))?;
        }

        tokio::fs::copy(&path, &dest)
            .await
            .map_err(|e| format!("Failed to snapshot '{}': {}", path.display(), e))?;
        saved_files.push(path.to_string_lossy().to_string());
    }

    // Write metadata
    let info = SnapshotInfo {
        id: snapshot_id.clone(),
        execution_id: execution_id.to_string(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        files: saved_files,
        created_files,
    };
    let meta_path = snapshot_dir.join("metadata.json");
    let meta_json =
        serde_json::to_string_pretty(&info).map_err(|e| format!("Failed to serialize: {}", e))?;
    tokio::fs::write(&meta_path, meta_json)
        .await
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    // Cleanup after the new metadata is written so the retention count
    // includes this snapshot (never leaves MAX_SNAPSHOTS + 1 behind).
    cleanup_old_snapshots(app_data_dir).await;

    Ok(snapshot_id)
}

/// Restore all files from a snapshot.
///
/// Reserved for the workflow-undo feature (roadmap: workflow-engine WI-5.4
/// "File Snapshots for Undo"). The write side (`create_snapshot`) is already
/// live in the runner; this read side is not yet wired to a Tauri command.
/// Kept deliberately per audit-remediation WI-1.5.
#[allow(dead_code)]
pub async fn restore_snapshot(
    app_data_dir: &Path,
    snapshot_id: &str,
    workspace_root: &Path,
) -> Result<(), String> {
    validate_id(snapshot_id)?;
    let snapshot_dir = app_data_dir.join("workflow-snapshots").join(snapshot_id);

    let meta_path = snapshot_dir.join("metadata.json");
    let meta_str = tokio::fs::read_to_string(&meta_path)
        .await
        .map_err(|e| format!("Snapshot not found: {}", e))?;
    let info: SnapshotInfo =
        serde_json::from_str(&meta_str).map_err(|e| format!("Invalid snapshot metadata: {}", e))?;

    // Canonical root so strip_prefix agrees with the canonicalized paths
    // that create_snapshot stores (e.g. /private/tmp vs /tmp on macOS).
    let canonical_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());

    for original_path_str in &info.files {
        let original_path = PathBuf::from(original_path_str);

        // Validate restore path with the same sandbox rules — catches symlink
        // escapes and metadata tampering (relative/absolute traversal). Stored
        // paths are canonicalized by create_snapshot → check canonical root.
        if let Err(e) = super::sandbox::validate_path(original_path_str, &canonical_root) {
            log::warn!("Skipping restore of '{}' — {}", original_path_str, e);
            continue;
        }

        // Find the snapshot file using relative path
        let Ok(relative) = original_path.strip_prefix(&canonical_root) else {
            log::warn!(
                "Skipping restore of '{}' — outside workspace",
                original_path_str
            );
            continue;
        };
        let snapshot_file = snapshot_dir.join(relative);

        if snapshot_file.exists() {
            // Create parent directory if needed
            if let Some(parent) = original_path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            tokio::fs::copy(&snapshot_file, &original_path)
                .await
                .map_err(|e| format!("Failed to restore '{}': {}", original_path_str, e))?;
        } else {
            log::warn!(
                "Snapshot file missing for '{}' — skipping",
                original_path_str
            );
        }
    }

    // Delete files that were created by the workflow (didn't exist before)
    for created_path_str in &info.created_files {
        if let Err(e) = super::sandbox::validate_path(created_path_str, &canonical_root) {
            log::warn!(
                "Skipping delete of created file '{}' — {}",
                created_path_str,
                e
            );
            continue;
        }
        let created_path = PathBuf::from(created_path_str);
        if created_path.exists() {
            if let Err(e) = tokio::fs::remove_file(&created_path).await {
                log::warn!(
                    "Failed to delete created file '{}': {}",
                    created_path_str,
                    e
                );
            }
        }
    }

    Ok(())
}

/// List recent snapshots, sorted by timestamp descending.
///
/// Reserved for the workflow-undo UI (roadmap: workflow-engine WI-5.4); not yet
/// wired to a Tauri command. Kept deliberately per audit-remediation WI-1.5.
#[allow(dead_code)]
pub async fn list_snapshots(app_data_dir: &Path) -> Result<Vec<SnapshotInfo>, String> {
    let snapshots_dir = app_data_dir.join("workflow-snapshots");
    if !snapshots_dir.exists() {
        return Ok(vec![]);
    }

    let mut snapshots = Vec::new();
    let mut dir = tokio::fs::read_dir(&snapshots_dir)
        .await
        .map_err(|e| format!("Failed to read snapshots directory: {}", e))?;

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))?
    {
        let meta_path = entry.path().join("metadata.json");
        if meta_path.exists() {
            match tokio::fs::read_to_string(&meta_path).await {
                Ok(meta_str) => match serde_json::from_str::<SnapshotInfo>(&meta_str) {
                    Ok(info) => snapshots.push(info),
                    Err(e) => log::warn!("Corrupt snapshot metadata at {:?}: {}", meta_path, e),
                },
                Err(e) => log::warn!("Unreadable snapshot at {:?}: {}", meta_path, e),
            }
        }
    }

    snapshots.sort_by_key(|s| std::cmp::Reverse(s.timestamp));
    snapshots.truncate(MAX_SNAPSHOTS);

    Ok(snapshots)
}

#[cfg(test)]
#[path = "snapshots.test.rs"]
mod tests;

/// Delete snapshot directories beyond MAX_SNAPSHOTS.
async fn cleanup_old_snapshots(app_data_dir: &Path) {
    let snapshots_dir = app_data_dir.join("workflow-snapshots");
    if !snapshots_dir.exists() {
        return;
    }

    // Collect all snapshot dirs with timestamps
    let mut entries: Vec<(PathBuf, u64)> = Vec::new();
    if let Ok(mut dir) = tokio::fs::read_dir(&snapshots_dir).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let meta_path = entry.path().join("metadata.json");
            if let Ok(meta_str) = tokio::fs::read_to_string(&meta_path).await {
                if let Ok(info) = serde_json::from_str::<SnapshotInfo>(&meta_str) {
                    entries.push((entry.path(), info.timestamp));
                }
            }
        }
    }

    if entries.len() <= MAX_SNAPSHOTS {
        return;
    }

    // Sort oldest first
    entries.sort_by_key(|(_, ts)| *ts);
    let to_remove = entries.len() - MAX_SNAPSHOTS;
    for (path, _) in entries.into_iter().take(to_remove) {
        if let Err(e) = tokio::fs::remove_dir_all(&path).await {
            log::warn!("Failed to cleanup old snapshot {:?}: {}", path, e);
        }
    }
}
