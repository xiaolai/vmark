//! Built-in `action/*` step implementations, extracted from `runner.rs`
//! (file-size baseline). All file I/O stays behind
//! `sandbox::validate_path`.
//!
//! Reads go through `bounded_read` (#253, #254): the file is opened FIRST,
//! its type and size are read from the open handle, and the limit holds on
//! the bytes consumed — so a file swapped for a FIFO between a check and
//! the read cannot block the step (the open does not wait), and a file that
//! grows cannot pass a size it was checked at. Folder reads live in
//! `actions_folder.rs`. Saves are committed by `commit.rs` (#258, #257):
//! atomically, and into a directory DESCRIPTOR the sandbox proved is inside
//! the workspace, so an ancestor swapped for a symlink after the check has
//! no path left to redirect. The parents a save has to CREATE first are
//! anchored the same way, in `ensure_dir.rs` — a path-based `create_dir_all`
//! here was the last step that still resolved the name a second time.

use super::actions_folder::read_folder;
use super::sandbox::validate_path;
use crate::bounded_read::{read_regular_bounded, BoundedReadError};

pub(super) use super::commit::commit_inside_workspace;
use std::collections::HashMap;
use std::path::Path;

pub(super) const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB

/// The parameters each built-in action refuses to run without. One table,
/// read by the executor (`require`) AND by `examples.rs`, so the bundled
/// sample is checked against the contract the runner enforces rather than
/// against a copy scraped from this file's error strings (#270).
pub(super) fn required_params(action: &str) -> &'static [&'static str] {
    match action {
        "read-file" | "read-folder" => &["path"],
        "save-file" => &["path", "input"],
        _ => &[],
    }
}

/// Fetch a required parameter, with the refusal the table promises. A
/// parameter the table does not declare is a bug in this file, caught in
/// debug and test builds — that is the join that keeps the table honest.
fn require<'p>(
    params: &'p HashMap<String, String>,
    action: &str,
    name: &str,
) -> Result<&'p String, String> {
    debug_assert!(
        required_params(action).contains(&name),
        "action/{action} reads '{name}' but does not declare it in required_params"
    );
    params
        .get(name)
        .ok_or_else(|| format!("action/{action} requires '{name}' parameter"))
}

/// Read a regular file whole, at most `limit` bytes, on the blocking pool —
/// the type and the size judged on the open handle, the limit on the bytes
/// read (`bounded_read`).
pub(super) async fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, BoundedReadError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || read_regular_bounded(&path, limit))
        .await
        .map_err(|e| BoundedReadError::Io(std::io::Error::other(e)))?
}

/// Execute a built-in action step: one routing table, one function per
/// action (#252) — the dispatcher decides WHICH, never HOW.
pub(super) async fn execute_action(
    uses: &str,
    params: &HashMap<String, String>,
    workspace_root: &Path,
) -> Result<String, String> {
    // REQUIRED, not stripped-if-present (audit 20260907 #495). `unwrap_or(uses)`
    // accepted a bare `read-file` and ran it, so a workflow that misspelt the
    // namespace behaved as if it had not — and the `action/*` contract this
    // module is named for held only by the runner's own courtesy
    // (`runner.rs` routes here on `uses.starts_with("action/")`, so nothing in
    // production ever reached the fallback). A silently-accepted second syntax
    // is a syntax, and this file only documents one.
    let Some(action) = uses.strip_prefix("action/") else {
        return Err(format!(
            "built-in steps are named `action/<name>`; got {uses:?}"
        ));
    };
    match action {
        "read-file" => read_file(require(params, action, "path")?, workspace_root).await,
        "read-folder" => {
            let path_str = require(params, action, "path")?;
            let path = validate_path(path_str, workspace_root)?;
            read_folder(path_str, &path, params, workspace_root).await
        }
        "save-file" => {
            let path_str = require(params, action, "path")?;
            let input = require(params, action, "input")?;
            save_file(path_str, input, workspace_root).await
        }
        "notify" => {
            let message = params.get("message").cloned().unwrap_or_default();
            log::info!("Workflow notification: {}", message);
            Ok(message)
        }
        "copy" => Ok(params.get("input").cloned().unwrap_or_default()),
        "prompt" => Err(rust_i18n::t!("errors.workflow.noInteractivePrompt").to_string()),
        _ => Err(format!("Unknown action: {}", action)),
    }
}

/// `action/read-file`: a regular file inside the workspace, at most
/// `MAX_FILE_SIZE_BYTES`, as UTF-8.
async fn read_file(path_str: &str, workspace_root: &Path) -> Result<String, String> {
    let path = validate_path(path_str, workspace_root)?;
    let bytes = read_bounded(&path, MAX_FILE_SIZE_BYTES)
        .await
        .map_err(|e| match e {
            BoundedReadError::NotRegular => format!("'{}' is not a regular file", path_str),
            BoundedReadError::TooLarge { limit } => {
                format!("File '{}' is too large (over {} bytes)", path_str, limit)
            }
            BoundedReadError::Io(e) => format!("Cannot access '{}': {}", path_str, e),
        })?;
    String::from_utf8(bytes).map_err(|e| format!("Failed to read '{}': {}", path_str, e))
}

/// Run `op` on the blocking pool, keeping a PANIC distinguishable from the
/// operation's own failure.
///
/// Both of `save_file`'s blocking steps hand-wrote this (audit 20260907 #501),
/// and each mapped the `JoinError` and the inner error through the SAME message
/// template — so "Failed to write 'x': ..." was produced by a permission
/// refusal and by a panic in `commit_inside_workspace` alike, with nothing in
/// the text to tell them apart. A panic is a bug in this crate; an I/O failure
/// is the user's filesystem. They are not the same report.
async fn blocking_io<T, E>(
    what: String,
    op: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    match tokio::task::spawn_blocking(op).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(e)) => Err(format!("{what}: {e}")),
        Err(join) => Err(format!("{what}: the blocking task panicked ({join})")),
    }
}

/// `action/save-file`: `input` replaces the file at `path_str` atomically
/// (#258), creating missing parents inside the workspace.
async fn save_file(path_str: &str, input: &str, workspace_root: &Path) -> Result<String, String> {
    let path = validate_path(path_str, workspace_root)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("'{}' has no parent directory", path_str))?
        .to_path_buf();
    // Anchored, like the commit below it: a `create_dir_all` here resolves the
    // path a second time, so an ancestor swapped since `validate_path` was
    // built into — outside the workspace — even though the write that followed
    // was then refused (#257, `ensure_dir.rs`).
    let (dirs, dirs_root) = (parent.clone(), workspace_root.to_path_buf());
    blocking_io(
        format!("Failed to create directory for '{path_str}'"),
        move || super::ensure_dir::create_parents_within(&dirs, &dirs_root),
    )
    .await?;
    let (target, root, bytes) = (
        path.clone(),
        workspace_root.to_path_buf(),
        input.as_bytes().to_vec(),
    );
    blocking_io(format!("Failed to write '{path_str}'"), move || {
        commit_inside_workspace(&target, &root, &bytes)
    })
    .await?;
    Ok(format!("Saved to {}", path_str))
}

/// Check if a filename matches an accept pattern. Supports `*`, a single
/// suffix pattern (`*.md` / `.md`), or a comma-separated list (`*.md,*.txt`).
///
/// ASCII case-INSENSITIVE (#505). Everywhere else in VMark an extension is
/// matched case-insensitively — `supported_files`, `genies::classify`, the
/// slidev export's own output check — so `*.md` silently excluded `README.MD`
/// from a folder read while the same file opened fine in the editor. Only the
/// ASCII case is folded: an extension is ASCII in every format this app
/// handles, and `to_lowercase` would bring locale-dependent mappings
/// (Turkish dotless i) into a filename comparison.
pub(super) fn matches_accept(name: &str, accept: &str) -> bool {
    if accept.trim().is_empty() || accept == "*" {
        return true;
    }
    let name = name.to_ascii_lowercase();
    accept
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .any(|p| p == "*" || name.ends_with(&p.trim_start_matches('*').to_ascii_lowercase()))
}

#[cfg(test)]
#[path = "actions.test.rs"]
mod tests;
