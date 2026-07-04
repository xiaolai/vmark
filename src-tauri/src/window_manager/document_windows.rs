//! Document/main window construction: cascade positioning, URL building,
//! label allocation, and the macOS dock-reopen workspace pick.
//!
//! Key decisions:
//!   - Windows start hidden and are shown only after the frontend emits "ready",
//!     preventing flash-of-unstyled-content on slow machines.
//!   - "main" label is preferred for the first document window so Finder file-open
//!     events (which target "main") work correctly.
//!   - macOS dock-icon reactivation restores the user's most-recent workspace via
//!     `pick_reopen_workspace_root` (validated against the live filesystem) instead
//!     of opening an unscoped untitled doc.

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Cascade offset for new windows (logical pixels)
const CASCADE_OFFSET: f64 = 25.0;
/// Base position for first window
const BASE_X: f64 = 100.0;
const BASE_Y: f64 = 100.0;
/// Max cascade steps before wrapping
const MAX_CASCADE: u32 = 10;
/// Minimum window size (also used as default)
const MIN_WIDTH: f64 = 800.0;
const MIN_HEIGHT: f64 = 600.0;

/// Get cascaded position based on window counter
fn get_cascaded_position(count: u32) -> (f64, f64) {
    // Wrap around after MAX_CASCADE to avoid windows going off-screen
    let step = (count % MAX_CASCADE) as f64;
    (
        BASE_X + step * CASCADE_OFFSET,
        BASE_Y + step * CASCADE_OFFSET,
    )
}

/// Build window URL with optional query params
fn build_window_url(file_path: Option<&str>, workspace_root: Option<&str>) -> String {
    let mut params = Vec::new();

    if let Some(path) = file_path {
        params.push(format!("file={}", urlencoding::encode(path)));
    }

    if let Some(root) = workspace_root {
        params.push(format!("workspaceRoot={}", urlencoding::encode(root)));
    }

    if params.is_empty() {
        "/".to_string()
    } else {
        format!("/?{}", params.join("&"))
    }
}

/// Build window URL with workspace root and multiple file paths.
pub(super) fn build_window_url_with_files(
    file_paths: &[String],
    workspace_root: Option<&str>,
) -> String {
    let mut params = Vec::new();

    if let Some(root) = workspace_root {
        params.push(format!("workspaceRoot={}", urlencoding::encode(root)));
    }

    if !file_paths.is_empty() {
        let serialized = serde_json::to_string(file_paths).unwrap_or_default();
        params.push(format!("files={}", urlencoding::encode(&serialized)));
    }

    if params.is_empty() {
        "/".to_string()
    } else {
        format!("/?{}", params.join("&"))
    }
}

/// Build a document window with the shared document-window configuration.
///
/// All document-window entry points (cascade-positioned doc windows, the
/// special "main" window, restore-with-label, transfers) funnel through here so
/// size / title-bar / focus settings can't drift between call sites. `position`
/// is `None` for the "main" window (it relies on saved window state / OS
/// placement); document windows pass an explicit cascade position.
fn build_document_window(
    app: &AppHandle,
    label: &str,
    url: String,
    position: Option<(f64, f64)>,
) -> Result<(), tauri::Error> {
    let title = String::new();

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(MIN_WIDTH, MIN_HEIGHT)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .fullscreen(false)
        .focused(true);

    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .accept_first_mouse(true);
    }

    builder.build()?;

    Ok(())
}

/// Create a new document window from a pre-built URL.
pub(crate) fn create_document_window_with_url(
    app: &AppHandle,
    url: String,
) -> Result<String, tauri::Error> {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("doc-{}", count);

    build_document_window(app, &label, url, Some(get_cascaded_position(count)))?;

    Ok(label)
}

/// Create a new document window for a tab transfer (drag-out).
/// The URL includes `?transfer=true` so the frontend can claim the data.
pub fn create_document_window_for_transfer(app: &AppHandle) -> Result<String, tauri::Error> {
    create_document_window_with_url(app, "/?transfer=true".to_string())
}

/// Allocate a unique window label without creating a window.
///
/// Increments the global window counter and returns the label that would
/// be assigned to the next window. Used by hot-exit restore to pre-allocate
/// labels before storing restore state (crash safety).
pub(crate) fn allocate_window_label() -> String {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("doc-{}", count)
}

/// Create a document window with a pre-allocated label and explicit URL.
///
/// Uses the given label instead of allocating a new one. The caller is
/// responsible for ensuring the label is unique (typically via
/// `allocate_window_label()`). Used by flows that must register routing /
/// restore state keyed on the label BEFORE the window can claim it.
pub(crate) fn create_document_window_with_label_and_url(
    app: &AppHandle,
    label: &str,
    url: String,
) -> Result<(), tauri::Error> {
    // Parse counter from label for cascade position (e.g., "doc-5" → 5)
    let count = label
        .strip_prefix("doc-")
        .and_then(|n| n.parse::<u32>().ok())
        .unwrap_or(0);

    build_document_window(app, label, url, Some(get_cascaded_position(count)))
}

/// Create a document window with a pre-allocated label (no file/workspace).
///
/// Uses the given label instead of allocating a new one. The caller is
/// responsible for ensuring the label is unique (typically via
/// `allocate_window_label()`).
pub(crate) fn create_document_window_with_label(
    app: &AppHandle,
    label: &str,
) -> Result<(), tauri::Error> {
    create_document_window_with_label_and_url(app, label, "/".to_string())
}

/// Create a new document window with optional file path and workspace root.
/// Returns the window label on success.
///
/// # Arguments
/// * `app` - Tauri AppHandle
/// * `file_path` - Optional file path to open
/// * `workspace_root` - Optional workspace root to set (for external file opens)
pub fn create_document_window(
    app: &AppHandle,
    file_path: Option<&str>,
    workspace_root: Option<&str>,
) -> Result<String, tauri::Error> {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("doc-{}", count);

    // Build URL with optional query params
    let url = build_window_url(file_path, workspace_root);

    build_document_window(app, &label, url, Some(get_cascaded_position(count)))?;

    Ok(label)
}

/// Create a new "main" window (used when the original main window was destroyed
/// and a file is opened from Finder, requiring useFinderFileOpen to handle it).
/// The main window label is special: useFinderFileOpen only runs for "main".
///
/// `workspace_root` lets the dock-icon-reopen path restore the user's last
/// workspace — without it the new window's WindowContext would explicitly
/// clear any persisted workspace state.
pub fn create_main_window(
    app: &AppHandle,
    workspace_root: Option<&str>,
) -> Result<String, tauri::Error> {
    let label = "main";

    let url = build_window_url(None, workspace_root);

    // No explicit position: the "main" window relies on saved window state /
    // OS placement rather than the cascade offset used by doc windows.
    build_document_window(app, label, url, None)?;

    Ok(label.to_string())
}

/// Pure decision function for `pick_reopen_workspace_root` — testable without
/// touching the filesystem or the recent-workspaces snapshot.
fn pick_reopen_workspace_root_with<F>(most_recent: Option<String>, path_exists: F) -> Option<String>
where
    F: Fn(&str) -> bool,
{
    most_recent.filter(|p| path_exists(p))
}

/// On macOS dock-icon reactivation (no visible windows), pick the workspace
/// to restore in the new main window. Returns the most-recent workspace if
/// it still exists on disk; otherwise `None` so the window opens unscoped.
///
/// Falls back to `None` (rather than scanning further down the recent list)
/// to keep behavior predictable: the user expects "the workspace I was just
/// in," not an older one they may not remember.
pub(crate) fn pick_reopen_workspace_root() -> Option<String> {
    pick_reopen_workspace_root_with(crate::menu::get_recent_workspace_path(0), |p| {
        std::path::Path::new(p).is_dir()
    })
}

#[cfg(test)]
#[path = "document_windows.test.rs"]
mod tests;
