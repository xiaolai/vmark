//! Tauri commands for opening files/workspaces in new windows, closing
//! windows, and quitting. Frontend-supplied paths are validated by
//! `path_validation` before any fs-scope extension or window creation.

use tauri::{AppHandle, Manager};

use crate::command_error::CommandError;

use super::document_windows::{
    build_window_url_with_files, create_document_window, create_document_window_with_url,
};
use super::path_validation::{validate_openable_path, validate_workspace_root};

/// Open a file in a new window (Tauri command)
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn open_file_in_new_window(app: AppHandle, path: String) -> Result<String, CommandError> {
    validate_openable_path(&path).map_err(CommandError::invalid_input)?;
    crate::allow_fs_read(&app, &path);
    create_document_window(&app, Some(&path), None)
        .map_err(|e| CommandError::internal(e.to_string()))
}

/// Open a workspace in a new window with optional file to open (Tauri command)
///
/// Creates a new window with the workspace root set. If a file path is provided,
/// it will be opened in the new window after the workspace is initialized.
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn open_workspace_in_new_window(
    app: AppHandle,
    workspace_root: String,
    file_path: Option<String>,
) -> Result<String, CommandError> {
    validate_workspace_root(&workspace_root).map_err(CommandError::invalid_input)?;
    if let Some(ref path) = file_path {
        validate_openable_path(path).map_err(CommandError::invalid_input)?;
        crate::allow_fs_read(&app, path);
    }
    create_document_window(&app, file_path.as_deref(), Some(&workspace_root))
        .map_err(|e| CommandError::internal(e.to_string()))
}

/// Open a workspace in a new window with multiple files.
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn open_workspace_with_files_in_new_window(
    app: AppHandle,
    workspace_root: String,
    file_paths: Vec<String>,
) -> Result<String, CommandError> {
    // Reject a missing / non-directory workspace root before extending any file
    // scopes or creating the window.
    validate_workspace_root(&workspace_root).map_err(CommandError::invalid_input)?;
    // Validate every path up-front so a single bad entry doesn't leave the
    // scope partially extended for the rest of the batch.
    for path in &file_paths {
        validate_openable_path(path).map_err(CommandError::invalid_input)?;
    }
    for path in &file_paths {
        crate::allow_fs_read(&app, path);
    }
    let url = build_window_url_with_files(&file_paths, Some(&workspace_root));
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
#[tauri::command]
pub fn close_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    label: String,
) -> Result<(), CommandError> {
    log::info!("[Tauri] close_window called for '{}'", label);

    if let Some(window) = app.get_webview_window(&label) {
        let result = window
            .destroy()
            .map_err(|e| CommandError::internal(e.to_string()));
        log::info!("[Tauri] window '{}' destroy result: {:?}", label, result);
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

/// Request quit - emits event to all windows for confirmation
#[tauri::command]
pub fn request_quit(app: AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("app:quit-requested", ());
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
