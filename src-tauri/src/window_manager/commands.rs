//! Tauri commands for opening files/workspaces in new windows, closing
//! windows, and quitting. Frontend-supplied paths are validated by
//! `path_validation` before any fs-scope extension or window creation.

use tauri::{AppHandle, Manager};

use super::document_windows::{
    build_window_url_with_files, create_document_window, create_document_window_with_url,
};
use super::path_validation::{validate_openable_path, validate_workspace_root};

/// Open a file in a new window (Tauri command)
#[tauri::command]
pub fn open_file_in_new_window(app: AppHandle, path: String) -> Result<String, String> {
    validate_openable_path(&path)?;
    crate::allow_fs_read(&app, &path);
    create_document_window(&app, Some(&path), None).map_err(|e| e.to_string())
}

/// Open a workspace in a new window with optional file to open (Tauri command)
///
/// Creates a new window with the workspace root set. If a file path is provided,
/// it will be opened in the new window after the workspace is initialized.
#[tauri::command]
pub fn open_workspace_in_new_window(
    app: AppHandle,
    workspace_root: String,
    file_path: Option<String>,
) -> Result<String, String> {
    validate_workspace_root(&workspace_root)?;
    if let Some(ref path) = file_path {
        validate_openable_path(path)?;
        crate::allow_fs_read(&app, path);
    }
    create_document_window(&app, file_path.as_deref(), Some(&workspace_root))
        .map_err(|e| e.to_string())
}

/// Open a workspace in a new window with multiple files.
#[tauri::command]
pub fn open_workspace_with_files_in_new_window(
    app: AppHandle,
    workspace_root: String,
    file_paths: Vec<String>,
) -> Result<String, String> {
    // Reject a missing / non-directory workspace root before extending any file
    // scopes or creating the window.
    validate_workspace_root(&workspace_root)?;
    // Validate every path up-front so a single bad entry doesn't leave the
    // scope partially extended for the rest of the batch.
    for path in &file_paths {
        validate_openable_path(path)?;
    }
    for path in &file_paths {
        crate::allow_fs_read(&app, path);
    }
    let url = build_window_url_with_files(&file_paths, Some(&workspace_root));
    create_document_window_with_url(&app, url).map_err(|e| e.to_string())
}

/// Close a specific window by label
#[tauri::command]
pub fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    log::debug!("[Tauri] close_window called for '{}'", label);

    if let Some(window) = app.get_webview_window(&label) {
        log::debug!("[Tauri] destroying window '{}'", label);
        let result = window.destroy().map_err(|e| e.to_string());
        log::debug!("[Tauri] window '{}' destroy result: {:?}", label, result);
        result
    } else {
        Err(format!("Window '{}' not found", label))
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
