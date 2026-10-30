//! The save panel the export flows show, and the record of what it answered.
//!
//! Purpose: `pick_export_target` puts the native save panel up for the calling
//! webview and records the user's answer as that webview's export target
//! (`ExportTargets`); the path comes back to the frontend, which passes it to
//! `export_pdf` / `export_via_pandoc` unchanged. No script can name a path and
//! have it recorded — only the panel's answer is.
//!
//! Key decisions:
//!   - `async`: a dialog shown from a synchronous command would be driven from
//!     the IPC thread.
//!   - No file-type filter, as before: on macOS 26 a filter makes the panel
//!     reject pasted text and delete typed input. The PDF suffix is added when
//!     the answer is recorded (`settle`).
//!   - `default_path` is applied as the dialog plugin's own `save` applies it:
//!     a path that is not an existing directory opens the panel in its parent
//!     with its file name filled in.
//!   - Only `show` touches the native panel; MockRuntime cannot show one, so it
//!     needs a running app. Everything after the answer is `settle`, tested in
//!     `mod.test.rs`.
//!   - `debug_grant_export_target` exists in debug builds only, for the e2e
//!     journey that drives a real export but cannot reach the OS panel. A
//!     debug build's automation bridge can already run arbitrary script in its
//!     webviews, so it grants nothing that build did not have; release builds
//!     do not contain it.
//!
//! @coordinates-with export_target/mod.rs — the registry and `settle`
//! @coordinates-with export/PdfExportDialog.tsx — the PDF caller
//! @coordinates-with export/pandocExport.ts — the Pandoc caller
//! @module export_target/commands

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::FilePath;
use tokio::sync::oneshot;

use super::{settle, ExportTargetKind, ExportTargets};
use crate::command_error::CommandError;

/// Show the save panel for an export and record the answer as the calling
/// webview's target. Returns the path to export to, or `None` on cancel.
#[tauri::command]
pub async fn pick_export_target<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    kind: ExportTargetKind,
    default_path: String,
    title: String,
) -> Result<Option<String>, CommandError> {
    let answered = show(&app, &webview.window(), PathBuf::from(default_path), title);
    let answer = answered.await;
    let targets = app.try_state::<ExportTargets>().ok_or_else(|| {
        CommandError::internal("ExportTargets is not managed — register it in lib.rs")
    })?;
    settle(&targets, webview.label(), kind, answer)
}

/// Record `path` as the calling webview's export target without a panel.
/// Debug builds only — see the module header.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_grant_export_target<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    kind: ExportTargetKind,
    path: String,
) -> Result<Option<String>, CommandError> {
    let targets = app.try_state::<ExportTargets>().ok_or_else(|| {
        CommandError::internal("ExportTargets is not managed — register it in lib.rs")
    })?;
    settle(
        &targets,
        webview.label(),
        kind,
        Ok(Some(FilePath::Path(PathBuf::from(path)))),
    )
}

/// Put the native save panel on screen; its answer arrives on the receiver.
fn show<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::Window<R>,
    default_path: PathBuf,
    title: String,
) -> oneshot::Receiver<Option<FilePath>> {
    use tauri_plugin_dialog::DialogExt;

    let mut dialog = app.dialog().file().set_title(title);
    #[cfg(any(windows, target_os = "macos"))]
    {
        dialog = dialog.set_parent(window);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = window;
    // Same separator normalization the plugin's own `save` does on Windows.
    let default_path: PathBuf = default_path.components().collect();
    if default_path.is_dir() {
        dialog = dialog.set_directory(default_path);
    } else {
        if let Some(parent) = default_path.parent().filter(|p| p.components().count() > 0) {
            dialog = dialog.set_directory(parent);
        }
        if let Some(name) = default_path.file_name() {
            dialog = dialog.set_file_name(name.to_string_lossy());
        }
    }
    let (answer, answered) = oneshot::channel();
    dialog.save_file(move |path| {
        let _ = answer.send(path);
    });
    answered
}
