//! File snapshots for workflow undo.
//!
//! Before any workflow execution that modifies files, snapshot all affected
//! files. Snapshots preserve the full relative path from the workspace root
//! to prevent filename collisions between files in different directories.
//!
//! The copy is bounded and cancellable (#267, `snapshot_copy.rs`): a cancel
//! that lands while the snapshot is being taken is observed within one
//! chunk, and a file past `MAX_SNAPSHOT_FILE_BYTES` — or a snapshot past
//! `MAX_SNAPSHOT_TOTAL_BYTES` — refuses the run rather than copying without
//! end. A snapshot directory is CREATED, never reused (#264): an execution
//! id that already has one is refused, so a repeated id cannot overwrite or
//! mix with an earlier run's files.

use super::snapshot_copy::{
    copy_bounded, CopyRefusal, MAX_SNAPSHOT_FILE_BYTES, MAX_SNAPSHOT_TOTAL_BYTES,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub use super::snapshot_restore::{list_snapshots, restore_snapshot};

const MAX_SNAPSHOTS: usize = 50;

/// Max accepted id length (a UUID is 36 chars; `snap-` + UUID is 41).
pub(super) const MAX_ID_LEN: usize = 64;

/// Validate a caller-supplied execution/snapshot id before it is embedded in
/// a filesystem path. Only ASCII alphanumerics, `-` and `_` are allowed, so
/// path separators and `..` traversal are structurally impossible.
pub(super) fn validate_id(id: &str) -> Result<(), String> {
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
    create_snapshot_unless(
        app_data_dir,
        execution_id,
        file_paths,
        workspace_root,
        &|| false,
    )
    .await
}

/// [`create_snapshot`] that stops as soon as `should_stop` says so (#267) —
/// the runner's cancel flag, checked between chunks of every copy.
pub async fn create_snapshot_unless(
    app_data_dir: &Path,
    execution_id: &str,
    file_paths: &[PathBuf],
    workspace_root: &Path,
    should_stop: &(dyn Fn() -> bool + Sync),
) -> Result<String, String> {
    validate_id(execution_id)?;
    let snapshot_id = format!("snap-{}", execution_id);
    let snapshots_root = app_data_dir.join("workflow-snapshots");
    let snapshot_dir = snapshots_root.join(&snapshot_id);

    tokio::fs::create_dir_all(&snapshots_root)
        .await
        .map_err(|e| format!("Failed to create snapshot directory: {}", e))?;
    // `create_dir`, not `create_dir_all`: this id's directory must not exist
    // yet (#264). Reusing an id would write this run's files over — and
    // among — an earlier run's.
    tokio::fs::create_dir(&snapshot_dir)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => format!(
                "a snapshot for execution id {execution_id:?} already exists; an execution id is used once"
            ),
            _ => format!("Failed to create snapshot directory: {}", e),
        })?;

    // Everything from here can fail, and until `metadata.json` lands the
    // directory is not a recovery point — it is a partial copy of the user's
    // files under an id nothing can reuse, because the `create_dir` above is
    // the reuse guard (audit #554). So the body is fallible-in-one-place and
    // the directory is removed unless it completes.
    let outcome = fill_snapshot(
        &snapshot_dir,
        execution_id,
        &snapshot_id,
        file_paths,
        workspace_root,
        should_stop,
    )
    .await;
    if outcome.is_err() {
        if let Err(e) = tokio::fs::remove_dir_all(&snapshot_dir).await {
            log::warn!("Failed to clean up the partial snapshot {snapshot_dir:?}: {e}");
        }
        return outcome;
    }

    // Cleanup after the new metadata is written so the retention count
    // includes this snapshot (never leaves MAX_SNAPSHOTS + 1 behind).
    cleanup_old_snapshots(app_data_dir).await;
    outcome
}

/// Copy every file into an already-created `snapshot_dir` and write its
/// metadata. Split out so the whole fallible span has one exit for the
/// caller's cleanup to hang on (#554).
async fn fill_snapshot(
    snapshot_dir: &Path,
    execution_id: &str,
    snapshot_id: &str,
    file_paths: &[PathBuf],
    workspace_root: &Path,
    should_stop: &(dyn Fn() -> bool + Sync),
) -> Result<String, String> {
    // Canonical root for strip_prefix: validate_path returns canonicalized
    // paths (/private/tmp on macOS), which won't strip against a raw /tmp root.
    let canonical_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());

    let mut saved_files = Vec::new();
    let mut created_files = Vec::new();
    let mut total_bytes: u64 = 0;

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

        // Bounded on the bytes copied, by the per-file cap or by what is
        // left of the total, and cancellable between chunks (#267).
        let remaining = MAX_SNAPSHOT_TOTAL_BYTES.saturating_sub(total_bytes);
        let limit = MAX_SNAPSHOT_FILE_BYTES.min(remaining);
        let copied = copy_bounded(&path, &dest, limit, should_stop)
            .await
            .map_err(|e| match e {
                CopyRefusal::Cancelled => {
                    "cancelled while the snapshot was being taken".to_string()
                }
                CopyRefusal::TooLarge { .. } if remaining < MAX_SNAPSHOT_FILE_BYTES => format!(
                    "snapshot would exceed {MAX_SNAPSHOT_TOTAL_BYTES} bytes in total at '{}'",
                    path.display()
                ),
                CopyRefusal::TooLarge { limit } => format!(
                    "'{}' is over the {limit}-byte snapshot limit",
                    path.display()
                ),
                CopyRefusal::Io(e) => format!("Failed to snapshot '{}': {}", path.display(), e),
            })?;
        total_bytes += copied;
        saved_files.push(path.to_string_lossy().to_string());
    }

    // Write metadata
    let info = SnapshotInfo {
        id: snapshot_id.to_string(),
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

    Ok(snapshot_id.to_string())
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
