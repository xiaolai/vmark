//! Tauri commands for opening files/workspaces in new windows, closing
//! windows, and quitting. Frontend-supplied paths are validated by
//! `path_validation` before any fs-scope extension or window creation.
//!
//! Every command is generic over the runtime (like `close_window` always
//! was), so `commands.test.rs` drives the real commands on a mock app (#249):
//! a refused path opens nothing and extends no scope, an accepted one opens a
//! `doc-N` window whose URL carries the file, a batch carries every file.
//!
//! What validation JUDGED is the only value that flows on — never the raw
//! string (#250). Tauri's `push_pattern` inserts the pattern as given AND its
//! canonical form resolved AT GRANT TIME (`tauri/src/scope/fs.rs`,
//! `canonicalize_parent`), while `is_allowed` canonicalizes each REQUEST before
//! matching. Granting the raw name therefore put whatever the link pointed at
//! during the grant into the scope — so a link re-pointed between the check and
//! the grant was granted the attacker's target with validation's blessing.
//!
//! Round 2 fixed the grant and kept handing the raw name to the WINDOW, which
//! only moved the same defect one step downstream: the URL is what the frontend
//! reads, watches and saves through, and each of those resolves the name again.
//! A link re-pointed after validation redirected all of them — inside the scope
//! it could reach, so the read still succeeded, on a file the user never chose.
//! Both now carry the canonical target, so a later swap has no name left to
//! redirect. `validate_then_grant` is the one place that ordering lives.

use tauri::{AppHandle, Manager};

use crate::command_error::CommandError;

use super::document_windows::{
    build_window_url_with_files, create_document_window, create_document_window_with_url,
};
use super::path_validation::{validate_openable_path, validate_workspace_root};

/// Validate every frontend-supplied path, then extend the fs read scope with
/// the CANONICAL target each validation judged (#250). Returns those targets,
/// and they are what the caller passes to the window — the raw strings go no
/// further than this function.
///
/// Validation happens for the whole batch before any grant, so one bad entry
/// leaves the scope untouched for the rest.
///
/// `between` runs after the last validation and before the first grant. It is
/// a seam, and it exists for one reason: that gap is the race this function was
/// written to close, and nothing else can drive it deterministically
/// (`commands.test.rs`). Production callers pass `|| {}`.
fn validate_then_grant<R: tauri::Runtime>(
    app: &AppHandle<R>,
    paths: &[String],
    between: impl FnOnce(),
) -> Result<Vec<String>, CommandError> {
    let mut judged = Vec::with_capacity(paths.len());
    for path in paths {
        judged.push(validate_openable_path(path).map_err(CommandError::invalid_input)?);
    }
    between();
    for canonical in &judged {
        // Strict here, best-effort elsewhere (#481): this function exists to
        // make these files readable in a window that does not exist yet, so a
        // grant that did not take is a window that would be refused every
        // read — reported now, with nothing opened, rather than as `forbidden
        // path` from inside a blank window.
        crate::fs_scope::grant_fs_read(app, canonical).map_err(CommandError::permission_denied)?;
    }
    Ok(judged)
}

/// Open a file in a new window (Tauri command)
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn open_file_in_new_window<R: tauri::Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<String, CommandError> {
    let judged = validate_then_grant(&app, std::slice::from_ref(&path), || {})?;
    create_document_window(&app, judged.first().map(String::as_str), None)
        .map_err(|e| CommandError::internal(e.to_string()))
}

/// Open a workspace in a new window with optional file to open (Tauri command)
///
/// Creates a new window with the workspace root set. If a file path is provided,
/// it will be opened in the new window after the workspace is initialized.
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn open_workspace_in_new_window<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace_root: String,
    file_path: Option<String>,
) -> Result<String, CommandError> {
    let root = validate_workspace_root(&workspace_root).map_err(CommandError::invalid_input)?;
    let judged = validate_then_grant(&app, file_path.as_slice(), || {})?;
    create_document_window(&app, judged.first().map(String::as_str), Some(&root))
        .map_err(|e| CommandError::internal(e.to_string()))
}

/// Open a workspace in a new window with multiple files.
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn open_workspace_with_files_in_new_window<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace_root: String,
    file_paths: Vec<String>,
) -> Result<String, CommandError> {
    // Reject a missing / non-directory workspace root before extending any file
    // scopes or creating the window.
    let root = validate_workspace_root(&workspace_root).map_err(CommandError::invalid_input)?;
    // Every path is validated before any is granted, so a single bad entry
    // doesn't leave the scope partially extended for the rest of the batch.
    let judged = validate_then_grant(&app, &file_paths, || {})?;
    let url = build_window_url_with_files(&judged, Some(&root));
    create_document_window_with_url(&app, url).map_err(|e| CommandError::internal(e.to_string()))
}

/// Close a specific window by label.
///
/// Generic over the runtime so a mock app can exercise the not-found branch
/// (`commands.test.rs`); the `#[tauri::command]` macro is unaffected.
///
/// Logs at INFO, not debug (#1253). This is the last step of the window-close
/// flow, and release builds filter `debug!` — so when a close stalled, the log
/// a user could send us was silent about whether `close_window` was ever
/// reached, let alone whether `destroy()` returned. The "called" and "destroy
/// result" pair is what distinguishes a frontend that never got here from a
/// `destroy()` that never came back.
///
/// The label is printed with `{:?}`, not inside quotes of our own (#484). It is
/// frontend-supplied, and `'{}'` let it carry a NEWLINE — so a caller could
/// write log lines of its own, in VMark's own format, between the "called" and
/// "destroy result" pair a reader uses to diagnose a stalled close. `{:?}` on a
/// `str` escapes the newline and quotes the value, so it can only ever be one
/// token on one line.
#[tauri::command]
pub fn close_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    label: String,
) -> Result<(), CommandError> {
    log::info!("[Tauri] close_window called for {label:?}");

    if let Some(window) = app.get_webview_window(&label) {
        let result = window
            .destroy()
            .map_err(|e| CommandError::internal(e.to_string()));
        log::info!("[Tauri] window {label:?} destroy result: {result:?}");
        result
    } else {
        // The label names no live window: absent, not malformed.
        Err(CommandError::not_found(format!(
            "Window '{label}' not found"
        )))
    }
}

/// Force quit the entire application
#[tauri::command]
pub fn force_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
