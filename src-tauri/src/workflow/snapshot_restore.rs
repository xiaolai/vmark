//! The read side of workflow snapshots: restore and list.
//!
//! Split from `snapshots.rs` at the file-size gate when the write side grew
//! its bounded, cancellable copy (#267). Both functions are reserved for the
//! workflow-undo feature (roadmap: workflow-engine WI-5.4 "File Snapshots for
//! Undo"): the write side is live in the runner; this read side is not yet
//! wired to a Tauri command. Kept deliberately per audit-remediation WI-1.5.
//!
//! @coordinates-with snapshots.rs — `SnapshotInfo`, and the re-export
//! @module workflow::snapshot_restore

use super::snapshots::{validate_id, SnapshotInfo};
use std::path::{Path, PathBuf};

const MAX_SNAPSHOTS: usize = 50;

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
