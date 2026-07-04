//! macOS Dock recent documents integration.
//!
//! Registers opened files with NSDocumentController so they appear
//! in the "Recent Documents" submenu when right-clicking the Dock icon.

use objc2::MainThreadMarker;
use objc2_app_kit::NSDocumentController;
use objc2_foundation::{NSString, NSURL};
use std::path::Path;

/// Frontend command: register a file with macOS Dock recent documents.
#[tauri::command]
pub fn register_dock_recent(path: String) {
    register_recent_document(&path);
}

/// Register a file path with macOS Recent Documents.
/// This makes the file appear in the Dock right-click menu.
pub fn register_recent_document(path: &str) {
    // Validate path exists
    if !Path::new(path).exists() {
        log::warn!("[dock_recent] Path does not exist: {}", path);
        return;
    }

    let Some(mtm) = MainThreadMarker::new() else {
        log::warn!("[dock_recent] Not on main thread, cannot register document");
        return;
    };

    let path_ns = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&path_ns);

    let controller = NSDocumentController::sharedDocumentController(mtm);
    controller.noteNewRecentDocumentURL(&url);

    log::debug!("[dock_recent] Registered: {}", path);
}
