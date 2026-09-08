//! macOS Dock recent documents integration.
//!
//! Registers opened files with NSDocumentController so they appear
//! in the "Recent Documents" submenu when right-clicking the Dock icon.
//!
//! The command validates the path where it is called and then DISPATCHES the
//! AppKit call onto the main thread through Tauri's event loop, so it is on
//! the thread `NSDocumentController` requires by construction rather than by
//! whichever thread delivered the IPC message (#137). What can be refused up
//! front is returned to the caller as a typed error; what AppKit refuses on
//! the main thread is logged, since by then the command has returned.
//!
//! The registration itself is a seam (#139): `try_register_with` runs the
//! path guard and then hands the path to a registrar, and the AppKit
//! registrar (`register_with_app_kit`) is one implementation of it. libtest
//! never runs a test on the main thread, so the AppKit half can only be
//! exercised by a live app; the successful path up to and including the
//! hand-over is pinned with an injected registrar in `dock_recent.test.rs`.

use objc2::MainThreadMarker;
use objc2_app_kit::NSDocumentController;
use objc2_foundation::{NSString, NSURL};
use std::path::Path;
use tauri::AppHandle;

use crate::command_error::CommandError;

/// Why a registration was skipped, in the order the guards run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SkipReason {
    /// The path does not exist on disk — never handed to AppKit.
    PathMissing,
    /// The path exists but is not a regular file — a directory, a socket…
    /// "Recent Documents" is a list of documents (#138).
    NotAFile,
    /// Not on the main thread. `NSDocumentController` is main-thread-only, so
    /// the call is refused rather than made.
    NotMainThread,
}

/// Frontend command: register a file with macOS Dock recent documents.
///
/// The path is checked HERE, so a caller learns about a missing or non-file
/// path from the rejection; the AppKit call itself runs on the main thread.
#[tauri::command]
pub fn register_dock_recent(app: AppHandle, path: String) -> Result<(), CommandError> {
    check_document_path(&path)?;
    app.run_on_main_thread(move || register_recent_document(&path))
        .map_err(|e| CommandError::internal(format!("could not reach the main thread: {e}")))
}

/// The path half of the guard, as the typed refusal the command returns.
///
/// The stat's failure keeps the OS's own class (#335). Every one of them used
/// to be `not-found`, so a file the user is not allowed to read — or a stalled
/// network volume — told the caller the path did not exist, which is the one
/// diagnosis it rules out.
fn check_document_path(path: &str) -> Result<(), CommandError> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => Ok(()),
        Ok(_) => Err(CommandError::invalid_input(format!(
            "{path} is not a document file"
        ))),
        Err(e) => Err(CommandError::from_io(&e, format!("{path}: {e}"))),
    }
}

/// Register a file path with macOS Recent Documents.
/// This makes the file appear in the Dock right-click menu.
pub fn register_recent_document(path: &str) {
    match try_register_recent_document(path) {
        Ok(()) => log::debug!("[dock_recent] Registered: {}", path),
        Err(SkipReason::PathMissing) => {
            log::warn!("[dock_recent] Path does not exist: {}", path);
        }
        Err(SkipReason::NotAFile) => {
            log::warn!("[dock_recent] Not a document file: {}", path);
        }
        Err(SkipReason::NotMainThread) => {
            log::warn!("[dock_recent] Not on main thread, cannot register document");
        }
    }
}

/// The guarded registration against AppKit. The refusals are returned rather
/// than logged so they can be asserted: a test thread is never the main
/// thread, which is exactly the path that has to stop short of AppKit.
fn try_register_recent_document(path: &str) -> Result<(), SkipReason> {
    try_register_with(path, register_with_app_kit)
}

/// The path guard, then the hand-over to `register`. The guard runs first on
/// EVERY thread: a missing path or a directory never reaches a registrar,
/// main thread or not.
fn try_register_with(
    path: &str,
    register: impl FnOnce(&str) -> Result<(), SkipReason>,
) -> Result<(), SkipReason> {
    let meta = std::fs::metadata(Path::new(path)).map_err(|_| SkipReason::PathMissing)?;
    if !meta.is_file() {
        return Err(SkipReason::NotAFile);
    }
    register(path)
}

/// The AppKit registrar: refuses off the main thread, otherwise notes the
/// URL with the shared `NSDocumentController`.
fn register_with_app_kit(path: &str) -> Result<(), SkipReason> {
    let Some(mtm) = MainThreadMarker::new() else {
        return Err(SkipReason::NotMainThread);
    };

    let path_ns = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&path_ns);

    let controller = NSDocumentController::sharedDocumentController(mtm);
    controller.noteNewRecentDocumentURL(&url);

    Ok(())
}

#[cfg(test)]
#[path = "dock_recent.test.rs"]
mod tests;
