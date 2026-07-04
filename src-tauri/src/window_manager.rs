//! # Window Manager
//!
//! Purpose: Creates and manages Tauri webview windows (document, settings, transfer).
//!
//! Pipeline: Menu/dock/CLI/Finder actions → functions here → `WebviewWindowBuilder` →
//! new OS window with the React frontend.
//!
//! Key decisions:
//!   - Windows start hidden and are shown only after the frontend emits "ready",
//!     preventing flash-of-unstyled-content on slow machines.
//!   - "main" label is preferred for the first document window so Finder file-open
//!     events (which target "main") work correctly.
//!   - File opens from Finder are grouped by workspace root so multiple files in the
//!     same directory open as tabs in a single window.
//!   - macOS dock-icon reactivation restores the user's most-recent workspace via
//!     `pick_reopen_workspace_root` (validated against the live filesystem) instead
//!     of opening an unscoped untitled doc.
//!   - Settings window is a singleton — re-shown and focused if already open.
//!
//! Known limitations:
//!   - Window counter is process-global (AtomicU32); labels are not recycled.

// Finder/dock-reopen helpers + the macOS-only settings `window` binding are
// compiled everywhere but only used on macOS; silence the off-macOS lints.
#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_variables))]

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::PendingFileOpen;

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Compute workspace root from a file path (parent directory).
/// Returns None if the file is at root level or path is invalid.
///
/// Root-level files (e.g., `/file.md` or `C:\file.md`) return None
/// to prevent opening the entire filesystem as a workspace.
pub fn get_workspace_root_for_file(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        // Exclude root paths (/, C:\, etc.) - they have no parent
        .filter(|p| p.parent().is_some())
        .map(|p| p.to_string_lossy().to_string())
}

/// What to do when files are opened from the system (Finder, CLI, etc.)
#[derive(Debug, PartialEq)]
pub enum FileOpenAction {
    /// Frontend is ready and main window exists — emit events directly
    EmitToMainWindow,
    /// Frontend is ready but no main window — queue files and create one
    QueueAndCreateWindow,
    /// Frontend not ready (cold start) — just queue files
    QueueOnly,
}

/// Decide how to handle file opens based on app state.
pub fn determine_file_open_action(frontend_ready: bool, has_main_window: bool) -> FileOpenAction {
    match (frontend_ready, has_main_window) {
        (true, true) => FileOpenAction::EmitToMainWindow,
        (true, false) => FileOpenAction::QueueAndCreateWindow,
        (false, _) => FileOpenAction::QueueOnly,
    }
}

/// Group file paths by their workspace root.
///
/// Returns a map from workspace root (or empty string for root-level files)
/// to the list of file paths in that workspace.
pub fn group_paths_by_workspace(paths: &[String]) -> HashMap<String, Vec<String>> {
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for path in paths {
        let key = get_workspace_root_for_file(path).unwrap_or_default();
        groups.entry(key).or_default().push(path.clone());
    }
    groups
}

/// Append files to the pending queue with a shared workspace root.
pub fn queue_pending_file_opens(
    pending: &mut Vec<PendingFileOpen>,
    file_paths: Vec<String>,
    workspace_root: Option<&str>,
) {
    for path in file_paths {
        pending.push(PendingFileOpen {
            path,
            workspace_root: workspace_root.map(String::from),
        });
    }
}

/// Combined Finder file-open state, guarded by a single mutex in `lib.rs`.
///
/// Keeping the readiness flag and the pending queue together lets the
/// readiness *check* and the queue *insertion* happen in one critical
/// section. That closes the TOCTOU (WI-0.8, C3) where
/// `get_pending_file_opens` flips `frontend_ready` and drains the queue
/// between an emit-side check and its queue insertion — which could otherwise
/// drop or double-deliver a Finder open. Mirrors the single-lock discipline of
/// `menu_events::check_ready_or_queue`.
pub struct FileOpenState {
    pub frontend_ready: bool,
    pub pending: Vec<PendingFileOpen>,
}

impl FileOpenState {
    pub const fn new() -> Self {
        Self {
            frontend_ready: false,
            pending: Vec::new(),
        }
    }
}

impl Default for FileOpenState {
    fn default() -> Self {
        Self::new()
    }
}

/// Outcome of an atomic file-open decision. The caller performs the side
/// effects (emit / create window) OUTSIDE the lock.
pub enum FileOpenOutcome {
    /// Frontend is ready — emit these payloads to the main window.
    Emit(Vec<PendingFileOpen>),
    /// Files were queued; if `create_window`, the caller must create a main
    /// window so the queue gets drained once React mounts.
    Queued { create_window: bool },
}

/// Decide what to do with a batch of opens and queue them if needed — all
/// while the caller holds the `FileOpenState` lock. Pure over the passed
/// state, so it is unit-testable without the global mutex.
pub fn decide_file_open_locked(
    state: &mut FileOpenState,
    has_main_window: bool,
    paths: Vec<String>,
    workspace_root: Option<&str>,
) -> FileOpenOutcome {
    match determine_file_open_action(state.frontend_ready, has_main_window) {
        FileOpenAction::EmitToMainWindow => {
            let payloads = paths
                .into_iter()
                .map(|path| PendingFileOpen {
                    path,
                    workspace_root: workspace_root.map(String::from),
                })
                .collect();
            FileOpenOutcome::Emit(payloads)
        }
        FileOpenAction::QueueAndCreateWindow => {
            queue_pending_file_opens(&mut state.pending, paths, workspace_root);
            FileOpenOutcome::Queued {
                create_window: true,
            }
        }
        FileOpenAction::QueueOnly => {
            queue_pending_file_opens(&mut state.pending, paths, workspace_root);
            FileOpenOutcome::Queued {
                create_window: false,
            }
        }
    }
}

/// Mark the frontend ready and drain the pending queue in one critical
/// section (caller passes the locked state). Returns the drained opens.
pub fn mark_ready_and_drain(state: &mut FileOpenState) -> Vec<PendingFileOpen> {
    state.frontend_ready = true;
    state.pending.drain(..).collect()
}

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
fn build_window_url_with_files(file_paths: &[String], workspace_root: Option<&str>) -> String {
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

/// Validate that a frontend-supplied path is safe to extend into the fs
/// read scope. Rejects non-files, paths whose extension isn't in
/// `crate::SUPPORTED_EXTENSIONS`, and paths that don't resolve on disk
/// — so a compromised webview can't escalate by invoking these commands
/// with arbitrary targets.
///
/// Canonicalization resolves symlinks so the registered-extension check
/// runs on the real target, not the link name (e.g. a `.md` symlink
/// pointing to `/etc/passwd` is rejected because the canonical target
/// isn't a registered VMark format).
///
/// Returns `Ok(())` when the raw path is acceptable. The raw string is
/// intentionally used downstream — the scope pattern must match what the
/// webview will pass to `readTextFile`, which is the same raw path.
fn validate_openable_path(raw: &str) -> Result<(), String> {
    let canonical = std::path::Path::new(raw)
        .canonicalize()
        .map_err(|e| format!("invalid path '{raw}': {e}"))?;
    // WI-1B.5 — security gate now accepts every registered format's
    // extension (markdown + txt + json + yaml + toml + html + svg +
    // mmd + code-viewer set). Symlink rejection still works because
    // canonicalize() resolves the link first; we then re-check the
    // canonical path against `is_openable_supported`. A symlink whose
    // target lives outside the registered set fails this check.
    if !crate::is_openable_supported(&canonical) {
        return Err(format!("path '{raw}' is not an openable VMark file"));
    }
    Ok(())
}

/// Validate that a frontend-supplied workspace root exists and is a directory
/// before it is used to build a trusted workspace-context window URL. A
/// compromised webview must not be able to open a "workspace" window scoped to
/// a non-directory (file, missing path, or symlink to one), so this rejects
/// anything that doesn't resolve to a real directory on disk.
fn validate_workspace_root(raw: &str) -> Result<(), String> {
    let canonical = std::path::Path::new(raw)
        .canonicalize()
        .map_err(|e| format!("invalid workspace root '{raw}': {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("workspace root '{raw}' is not a directory"));
    }
    Ok(())
}

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

/// Create or focus the settings window.
/// If settings window exists, focuses it. Otherwise creates a new one.
/// Returns the window label on success.
pub fn show_settings_window(app: &AppHandle) -> Result<String, tauri::Error> {
    show_settings_window_section(app, None)
}

/// Tauri command wrapper for frontend Settings entry points.
#[tauri::command]
pub fn open_settings_window(app: AppHandle, section: Option<String>) -> Result<String, String> {
    show_settings_window_section(&app, section.as_deref().filter(|s| !s.is_empty()))
        .map_err(|e| e.to_string())
}

/// Create or focus the settings window, optionally navigating to a specific section.
/// If settings window exists, focuses it and navigates to the section.
/// Otherwise creates a new one with the section in the URL.
pub fn show_settings_window_section(
    app: &AppHandle,
    section: Option<&str>,
) -> Result<String, tauri::Error> {
    use tauri::Emitter;

    const SETTINGS_LABEL: &str = "settings";
    const SETTINGS_WIDTH: f64 = 760.0;
    const SETTINGS_HEIGHT: f64 = 540.0;
    const SETTINGS_MIN_WIDTH: f64 = 600.0;
    const SETTINGS_MIN_HEIGHT: f64 = 400.0;

    // If settings window exists, bring it to front, focus, and navigate to section
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        log::debug!("[window_manager] Settings window exists, focusing it");
        // Unminimize if minimized
        if window.is_minimized().unwrap_or(false) {
            log::debug!("[window_manager] Settings was minimized, unminimizing");
            let _ = window.unminimize();
        }
        // Show and focus
        let _ = window.show();
        let _ = window.set_focus();
        // Navigate to section if specified
        if let Some(s) = section {
            let _ = window.emit("settings:navigate", s);
        }
        return Ok(SETTINGS_LABEL.to_string());
    }

    log::debug!("[window_manager] Creating new settings window");

    // Build URL with optional section query param. Percent-encode the section
    // so a value containing reserved chars (&, ?, #) can't corrupt the query.
    let url = match section {
        Some(s) => format!("/settings?section={}", urlencoding::encode(s)),
        None => "/settings".to_string(),
    };

    // Create new settings window.
    //
    // On Linux/GTK, creating the window hidden and then changing size/position
    // before show can leave the native titlebar hit-test region stale until the
    // first maximize/unmaximize cycle. Create non-macOS settings windows with
    // their final geometry up front so close/minimize/maximize respond
    // immediately.
    let settings_title = rust_i18n::t!("window.settings.title").to_string();
    let mut builder = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App(url.into()))
        .title(&settings_title)
        .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
        .min_inner_size(SETTINGS_MIN_WIDTH, SETTINGS_MIN_HEIGHT)
        .resizable(true)
        .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .visible(false);
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder
            .menu(tauri::menu::Menu::new(app)?)
            .center()
            .visible(true);
    }

    let window = builder.build()?;

    #[cfg(target_os = "macos")]
    {
        // Override any restored state by explicitly setting size and centering.
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: SETTINGS_WIDTH,
            height: SETTINGS_HEIGHT,
        }));
        let _ = window.center();
        let _ = window.show();
    }

    Ok(SETTINGS_LABEL.to_string())
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
#[path = "window_manager.test.rs"]
mod tests;
