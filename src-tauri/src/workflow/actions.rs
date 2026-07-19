//! Built-in `action/*` step implementations, extracted from `runner.rs`
//! (file-size baseline). All file I/O stays behind
//! `sandbox::validate_path`.

use super::sandbox::validate_path;
use std::collections::HashMap;
use std::path::Path;

const MAX_FILES_PER_FOLDER: usize = 1000;
const MAX_TOTAL_READ_BYTES: u64 = 100 * 1024 * 1024; // 100MB
const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB

/// Execute a built-in action step.
pub(super) async fn execute_action(
    uses: &str,
    params: &HashMap<String, String>,
    workspace_root: &Path,
) -> Result<String, String> {
    let action = uses.strip_prefix("action/").unwrap_or(uses);
    match action {
        "read-file" => {
            let path_str = params
                .get("path")
                .ok_or("action/read-file requires 'path' parameter")?;
            let path = validate_path(path_str, workspace_root)?;
            let meta = tokio::fs::metadata(&path)
                .await
                .map_err(|e| format!("Cannot access '{}': {}", path_str, e))?;
            if meta.len() > MAX_FILE_SIZE_BYTES {
                return Err(format!(
                    "File '{}' is too large ({} bytes, max {})",
                    path_str,
                    meta.len(),
                    MAX_FILE_SIZE_BYTES
                ));
            }
            tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| format!("Failed to read '{}': {}", path_str, e))
        }
        "read-folder" => {
            let path_str = params
                .get("path")
                .ok_or("action/read-folder requires 'path' parameter")?;
            let path = validate_path(path_str, workspace_root)?;
            // Canonical root for per-entry symlink containment checks below.
            let canonical_root = workspace_root
                .canonicalize()
                .unwrap_or_else(|_| workspace_root.to_path_buf());
            let accept = params.get("accept").map(|s| s.as_str()).unwrap_or("*");
            let mut entries = Vec::new();
            let mut total_bytes: u64 = 0;
            let mut file_count: usize = 0;
            let mut dir = tokio::fs::read_dir(&path)
                .await
                .map_err(|e| format!("Failed to read directory '{}': {}", path_str, e))?;

            while let Some(entry) = dir
                .next_entry()
                .await
                .map_err(|e| format!("Failed to read entry: {}", e))?
            {
                file_count += 1;
                if file_count > MAX_FILES_PER_FOLDER {
                    return Err(format!(
                        "Directory '{}' exceeds max file limit ({})",
                        path_str, MAX_FILES_PER_FOLDER
                    ));
                }

                let name = entry.file_name().to_string_lossy().to_string();
                if !matches_accept(&name, accept) {
                    continue;
                }

                // Resolve symlinks and verify the target stays inside the
                // workspace — the directory was validated, but an entry may
                // be a symlink pointing outside the sandbox.
                let entry_path = match tokio::fs::canonicalize(entry.path()).await {
                    Ok(p) => p,
                    Err(e) => {
                        log::warn!("Skipping unresolvable entry '{}': {}", name, e);
                        continue;
                    }
                };
                if !entry_path.starts_with(&canonical_root) {
                    log::warn!("Skipping '{}': resolves outside the workspace", name);
                    continue;
                }

                let meta = match tokio::fs::metadata(&entry_path).await {
                    Ok(m) => m,
                    Err(e) => {
                        log::warn!("Skipping unreadable file '{}': {}", name, e);
                        continue;
                    }
                };
                if !meta.is_file() {
                    continue;
                }
                if meta.len() > MAX_FILE_SIZE_BYTES {
                    log::warn!("Skipping oversized file '{}' ({} bytes)", name, meta.len());
                    continue;
                }
                total_bytes += meta.len();
                if total_bytes > MAX_TOTAL_READ_BYTES {
                    return Err(format!(
                        "Total read size exceeds limit ({} bytes)",
                        MAX_TOTAL_READ_BYTES
                    ));
                }

                match tokio::fs::read_to_string(&entry_path).await {
                    Ok(content) => {
                        entries.push(format!("--- {} ---\n{}", name, content));
                    }
                    Err(e) => {
                        log::warn!("Skipping unreadable file '{}': {}", name, e);
                    }
                }
            }
            Ok(entries.join("\n\n"))
        }
        "save-file" => {
            let path_str = params
                .get("path")
                .ok_or("action/save-file requires 'path' parameter")?;
            let path = validate_path(path_str, workspace_root)?;
            let input = params
                .get("input")
                .ok_or("action/save-file requires 'input' parameter")?;
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("Failed to create directory for '{}': {}", path_str, e))?;
            }
            tokio::fs::write(&path, input)
                .await
                .map_err(|e| format!("Failed to write '{}': {}", path_str, e))?;
            Ok(format!("Saved to {}", path_str))
        }
        "notify" => {
            let message = params.get("message").cloned().unwrap_or_default();
            log::info!("Workflow notification: {}", message);
            Ok(message)
        }
        "copy" => {
            let input = params.get("input").cloned().unwrap_or_default();
            Ok(input)
        }
        "prompt" => Err(rust_i18n::t!("errors.workflow.noInteractivePrompt").to_string()),
        _ => Err(format!("Unknown action: {}", action)),
    }
}

/// Check if a filename matches an accept pattern. Supports `*`, a single
/// suffix pattern (`*.md` / `.md`), or a comma-separated list (`*.md,*.txt`).
pub(super) fn matches_accept(name: &str, accept: &str) -> bool {
    if accept.trim().is_empty() || accept == "*" {
        return true;
    }
    accept
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .any(|p| p == "*" || name.ends_with(p.trim_start_matches('*')))
}
