//! Runtime extension of the fs + asset-protocol read scopes.
//!
//! The STATIC capability scope (`capabilities/default.json`) covers `$HOME/**`,
//! `/Volumes/**`, `/mnt/**` and `/media/**`. That is deliberately narrow, so
//! anything the user opens from outside it — a file from Finder or the CLI, a
//! workspace on another drive — has to be granted here at runtime.
//!
//! Two properties of these grants drive every caller:
//!   - they are IN-MEMORY and do not survive a restart, so a path must be
//!     re-granted on every launch that opens it, not once when it is first
//!     picked;
//!   - `allow_file` grants exactly one path, while `allow_directory(p, r)`
//!     pushes `p/*` when `r` is false and `p/**` when true — so a workspace
//!     needs the recursive form or its subdirectories stay out of scope.
//!
//! Split out of `file_open.rs` when that file crossed the 300-line limit:
//! granting scope is a separate concern from queueing Finder/CLI opens.
//!
//! @coordinates-with file_open.rs — queues the opens these grants make readable
//! @coordinates-with services/workspaces/openWorkspaceByPath.ts — the JS caller

use tauri::Manager;

/// Runtime-extend the fs + asset read scopes for a path the user asked to open.
/// Files from Finder / CLI / "open in new window" can live anywhere
/// (`/private/tmp`, `/etc`), so `readTextFile` rejects them until extended
/// here. The asset-protocol scope (cwd-relative) needs the same per-file grant
/// so `convertFileSrc`/asset:// serves the file (inline images + media viewer).
/// Best-effort: failures logged, not propagated.
pub(crate) fn allow_fs_read<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) {
    use tauri_plugin_fs::FsExt;
    if let Err(e) = app.fs_scope().allow_file(path) {
        log::warn!("[fs-scope] Failed to allow file '{}': {}", path, e);
    }
    if let Err(e) = app.asset_protocol_scope().allow_file(path) {
        log::warn!("[asset-scope] Failed to allow file '{}': {}", path, e);
    }
}

/// Runtime-extend the fs + asset read scopes for a DIRECTORY tree the user
/// opened as a workspace (#1252).
///
/// `allow_fs_read` grants a single path, which is right for one opened file and
/// wrong for a workspace: a non-recursive grant leaves every SUBDIRECTORY out
/// of scope.
///
/// Invisible on macOS and Linux, where the static scope already covers where
/// users keep files. On Windows `$HOME` is `C:\Users\<name>`, so a workspace on
/// any other drive letter is covered by nothing and every file in it is refused
/// with `forbidden path: …`. Best-effort: failures logged, not propagated.
pub(crate) fn allow_fs_read_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) {
    use tauri_plugin_fs::FsExt;
    if let Err(e) = app.fs_scope().allow_directory(path, true) {
        log::warn!("[fs-scope] Failed to allow directory '{}': {}", path, e);
    }
    if let Err(e) = app.asset_protocol_scope().allow_directory(path, true) {
        log::warn!("[asset-scope] Failed to allow directory '{}': {}", path, e);
    }
}

/// Grant the fs + asset read scopes for a workspace root the frontend is about
/// to open (#1252).
///
/// Called from `openWorkspaceByPath` — the single JS funnel for the folder
/// picker, "Open Recent" and the `open_workspace` MCP handler — because grants
/// do not survive a restart. A workspace restored from the previous session, or
/// reopened from recents, never passes through a dialog and so would otherwise
/// be granted nothing.
///
/// Best-effort by design: a failed grant is logged and the open proceeds. The
/// static scope still covers the common case, so refusing the whole open here
/// would turn a partial degradation into a hard failure.
#[tauri::command]
pub fn allow_workspace_access(app: tauri::AppHandle, path: String) {
    allow_fs_read_dir(&app, &path);
}

#[cfg(test)]
#[path = "fs_scope.test.rs"]
mod tests;
