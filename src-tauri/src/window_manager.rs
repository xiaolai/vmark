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
//!   - Settings window is a singleton — re-shown and focused if already open.
//!
//! Known limitations:
//!   - Window counter is process-global (AtomicU32); labels are not recycled.

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

/// Create a new document window from a pre-built URL.
fn create_document_window_with_url(
    app: &AppHandle,
    url: String,
) -> Result<String, tauri::Error> {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("doc-{}", count);

    let title = String::new();
    let (x, y) = get_cascaded_position(count);

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(MIN_WIDTH, MIN_HEIGHT)
        .min_inner_size(800.0, 600.0)
        .position(x, y)
        .resizable(true)
        .fullscreen(false)
        .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .accept_first_mouse(true);
    }

    builder.build()?;

    Ok(label)
}

/// Create a new document window for a tab transfer (drag-out).
/// The URL includes `?transfer=true` so the frontend can claim the data.
pub fn create_document_window_for_transfer(
    app: &AppHandle,
) -> Result<String, tauri::Error> {
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

/// Create a document window with a pre-allocated label (no file/workspace).
///
/// Uses the given label instead of allocating a new one. The caller is
/// responsible for ensuring the label is unique (typically via
/// `allocate_window_label()`).
pub(crate) fn create_document_window_with_label(
    app: &AppHandle,
    label: &str,
) -> Result<(), tauri::Error> {
    let title = String::new();

    // Parse counter from label for cascade position (e.g., "doc-5" → 5)
    let count = label
        .strip_prefix("doc-")
        .and_then(|n| n.parse::<u32>().ok())
        .unwrap_or(0);
    let (x, y) = get_cascaded_position(count);

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("/".into()))
        .title(&title)
        .inner_size(MIN_WIDTH, MIN_HEIGHT)
        .min_inner_size(800.0, 600.0)
        .position(x, y)
        .resizable(true)
        .fullscreen(false)
        .focused(true);

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

    // Empty initial title - React will update based on settings
    let title = String::new();

    // Get cascaded position (always use minimum size for new windows)
    let (x, y) = get_cascaded_position(count);

    // CRITICAL: Full window configuration for proper behavior
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(MIN_WIDTH, MIN_HEIGHT)
        .min_inner_size(800.0, 600.0)
        .position(x, y)
        .resizable(true)
        .fullscreen(false)
        .focused(true);

    // macOS-specific: title bar styling and accept first mouse
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .accept_first_mouse(true);
    }

    builder.build()?;

    Ok(label)
}

/// Create a new "main" window (used when the original main window was destroyed
/// and a file is opened from Finder, requiring useFinderFileOpen to handle it).
/// The main window label is special: useFinderFileOpen only runs for "main".
pub fn create_main_window(app: &AppHandle) -> Result<String, tauri::Error> {
    let label = "main";

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("/".into()))
        .title("")
        .inner_size(MIN_WIDTH, MIN_HEIGHT)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .fullscreen(false)
        .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .accept_first_mouse(true);
    }

    builder.build()?;

    Ok(label.to_string())
}

/// Create a new empty window (Tauri command)
#[tauri::command]
pub fn new_window(app: AppHandle) -> Result<String, String> {
    create_document_window(&app, None, None).map_err(|e| e.to_string())
}

/// Open a file in a new window (Tauri command)
#[tauri::command]
pub fn open_file_in_new_window(app: AppHandle, path: String) -> Result<String, String> {
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
    create_document_window(
        &app,
        file_path.as_deref(),
        Some(&workspace_root),
    )
    .map_err(|e| e.to_string())
}

/// Open a workspace in a new window with multiple files.
#[tauri::command]
pub fn open_workspace_with_files_in_new_window(
    app: AppHandle,
    workspace_root: String,
    file_paths: Vec<String>,
) -> Result<String, String> {
    let url = build_window_url_with_files(&file_paths, Some(&workspace_root));
    create_document_window_with_url(&app, url).map_err(|e| e.to_string())
}

/// Close a specific window by label
#[tauri::command]
pub fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[Tauri] close_window called for '{}'", label);

    if let Some(window) = app.get_webview_window(&label) {
        #[cfg(debug_assertions)]
        eprintln!("[Tauri] destroying window '{}'", label);
        let result = window.destroy().map_err(|e| e.to_string());
        #[cfg(debug_assertions)]
        eprintln!("[Tauri] window '{}' destroy result: {:?}", label, result);
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

/// Create or focus the settings window, optionally navigating to a specific section.
/// If settings window exists, focuses it and navigates to the section.
/// Otherwise creates a new one with the section in the URL.
pub fn show_settings_window_section(app: &AppHandle, section: Option<&str>) -> Result<String, tauri::Error> {
    use tauri::Emitter;

    const SETTINGS_LABEL: &str = "settings";
    const SETTINGS_WIDTH: f64 = 760.0;
    const SETTINGS_HEIGHT: f64 = 540.0;
    const SETTINGS_MIN_WIDTH: f64 = 600.0;
    const SETTINGS_MIN_HEIGHT: f64 = 400.0;

    // If settings window exists, bring it to front, focus, and navigate to section
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        #[cfg(debug_assertions)]
        eprintln!("[window_manager] Settings window exists, focusing it");
        // Unminimize if minimized
        if window.is_minimized().unwrap_or(false) {
            #[cfg(debug_assertions)]
            eprintln!("[window_manager] Settings was minimized, unminimizing");
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

    #[cfg(debug_assertions)]
    eprintln!("[window_manager] Creating new settings window");

    // Build URL with optional section query param
    let url = match section {
        Some(s) => format!("/settings?section={}", s),
        None => "/settings".to_string(),
    };

    // Create new settings window
    // Note: Don't use .center() here as the window-state plugin may override it.
    // Instead, we build the window visible:false, then set size/position, then show.
    let mut builder = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App(url.into()),
    )
    .title("Settings")
    .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
    .min_inner_size(SETTINGS_MIN_WIDTH, SETTINGS_MIN_HEIGHT)
    .resizable(true)
    .visible(false) // Start hidden to avoid flash
    .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    let window = builder.build()?;

    // Override any restored state by explicitly setting size and centering
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: SETTINGS_WIDTH,
        height: SETTINGS_HEIGHT,
    }));
    let _ = window.center();
    let _ = window.show();

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
mod tests {
    use super::*;

    // -- get_workspace_root_for_file -------------------------------------------

    #[test]
    fn workspace_root_nested_file() {
        assert_eq!(
            get_workspace_root_for_file("/Users/alice/project/file.md"),
            Some("/Users/alice/project".to_string())
        );
    }

    #[test]
    fn workspace_root_home_level_file() {
        assert_eq!(
            get_workspace_root_for_file("/Users/alice/file.md"),
            Some("/Users/alice".to_string())
        );
    }

    #[test]
    fn workspace_root_root_level_file() {
        assert_eq!(get_workspace_root_for_file("/file.md"), None);
    }

    #[test]
    fn workspace_root_empty_string() {
        assert_eq!(get_workspace_root_for_file(""), None);
    }

    // -- determine_file_open_action --------------------------------------------

    #[test]
    fn action_ready_with_window() {
        assert_eq!(
            determine_file_open_action(true, true),
            FileOpenAction::EmitToMainWindow,
        );
    }

    #[test]
    fn action_ready_without_window() {
        assert_eq!(
            determine_file_open_action(true, false),
            FileOpenAction::QueueAndCreateWindow,
        );
    }

    #[test]
    fn action_not_ready_with_window() {
        assert_eq!(
            determine_file_open_action(false, true),
            FileOpenAction::QueueOnly,
        );
    }

    #[test]
    fn action_not_ready_without_window() {
        assert_eq!(
            determine_file_open_action(false, false),
            FileOpenAction::QueueOnly,
        );
    }

    // -- group_paths_by_workspace ----------------------------------------------

    #[test]
    fn group_single_file() {
        let paths = vec!["/Users/alice/project/file.md".to_string()];
        let groups = group_paths_by_workspace(&paths);
        assert_eq!(groups.len(), 1);
        assert_eq!(
            groups["/Users/alice/project"],
            vec!["/Users/alice/project/file.md"]
        );
    }

    #[test]
    fn group_same_directory() {
        let paths = vec![
            "/Users/alice/project/a.md".to_string(),
            "/Users/alice/project/b.md".to_string(),
        ];
        let groups = group_paths_by_workspace(&paths);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups["/Users/alice/project"].len(), 2);
    }

    #[test]
    fn group_different_directories() {
        let paths = vec![
            "/Users/alice/proj1/a.md".to_string(),
            "/Users/alice/proj2/b.md".to_string(),
        ];
        let groups = group_paths_by_workspace(&paths);
        assert_eq!(groups.len(), 2);
        assert!(groups.contains_key("/Users/alice/proj1"));
        assert!(groups.contains_key("/Users/alice/proj2"));
    }

    #[test]
    fn group_root_level_file() {
        let paths = vec!["/file.md".to_string()];
        let groups = group_paths_by_workspace(&paths);
        assert_eq!(groups.len(), 1);
        assert!(groups.contains_key(""));
    }

    #[test]
    fn group_empty_input() {
        let groups = group_paths_by_workspace(&[]);
        assert!(groups.is_empty());
    }

    // -- queue_pending_file_opens ----------------------------------------------

    #[test]
    fn queue_single_file_with_workspace() {
        let mut pending = Vec::new();
        queue_pending_file_opens(&mut pending, vec!["/a/b.md".to_string()], Some("/a"));
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].path, "/a/b.md");
        assert_eq!(pending[0].workspace_root, Some("/a".to_string()));
    }

    #[test]
    fn queue_multiple_files_same_workspace() {
        let mut pending = Vec::new();
        queue_pending_file_opens(
            &mut pending,
            vec!["/a/x.md".to_string(), "/a/y.md".to_string()],
            Some("/a"),
        );
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].workspace_root, Some("/a".to_string()));
        assert_eq!(pending[1].workspace_root, Some("/a".to_string()));
    }

    #[test]
    fn queue_without_workspace() {
        let mut pending = Vec::new();
        queue_pending_file_opens(&mut pending, vec!["/file.md".to_string()], None);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].workspace_root, None);
    }

    #[test]
    fn queue_appends_to_existing() {
        let mut pending = vec![PendingFileOpen {
            path: "/existing.md".to_string(),
            workspace_root: None,
        }];
        queue_pending_file_opens(&mut pending, vec!["/new.md".to_string()], Some("/dir"));
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].path, "/existing.md");
        assert_eq!(pending[1].path, "/new.md");
    }

    #[test]
    fn queue_empty_file_paths_is_noop() {
        let mut pending = Vec::new();
        queue_pending_file_opens(&mut pending, vec![], Some("/a"));
        assert!(pending.is_empty());
    }

    // -- get_cascaded_position ------------------------------------------------

    #[test]
    fn cascade_first_window() {
        let (x, y) = get_cascaded_position(0);
        assert_eq!(x, BASE_X);
        assert_eq!(y, BASE_Y);
    }

    #[test]
    fn cascade_third_window() {
        let (x, y) = get_cascaded_position(3);
        assert_eq!(x, BASE_X + 3.0 * CASCADE_OFFSET);
        assert_eq!(y, BASE_Y + 3.0 * CASCADE_OFFSET);
    }

    #[test]
    fn cascade_wraps_after_max() {
        // Position at MAX_CASCADE should wrap to 0
        let (x, y) = get_cascaded_position(MAX_CASCADE);
        assert_eq!(x, BASE_X);
        assert_eq!(y, BASE_Y);
    }

    #[test]
    fn cascade_wraps_correctly() {
        // Position at MAX_CASCADE + 2 should be same as position 2
        let (x1, y1) = get_cascaded_position(2);
        let (x2, y2) = get_cascaded_position(MAX_CASCADE + 2);
        assert_eq!(x1, x2);
        assert_eq!(y1, y2);
    }

    // -- build_window_url -----------------------------------------------------

    #[test]
    fn url_no_params() {
        assert_eq!(build_window_url(None, None), "/");
    }

    #[test]
    fn url_file_only() {
        let url = build_window_url(Some("/path/to/file.md"), None);
        assert!(url.starts_with("/?file="));
        assert!(url.contains("%2Fpath%2Fto%2Ffile.md"));
    }

    #[test]
    fn url_workspace_only() {
        let url = build_window_url(None, Some("/workspace"));
        assert!(url.starts_with("/?workspaceRoot="));
    }

    #[test]
    fn url_both_params() {
        let url = build_window_url(Some("/a/b.md"), Some("/a"));
        assert!(url.contains("file="));
        assert!(url.contains("workspaceRoot="));
        assert!(url.contains("&"));
    }

    // -- build_window_url_with_files ------------------------------------------

    #[test]
    fn url_with_files_empty() {
        assert_eq!(build_window_url_with_files(&[], None), "/");
    }

    #[test]
    fn url_with_files_single() {
        let url = build_window_url_with_files(&["/a/b.md".to_string()], Some("/a"));
        assert!(url.contains("workspaceRoot="));
        assert!(url.contains("files="));
    }

    #[test]
    fn url_with_files_multiple() {
        let files = vec!["/a/x.md".to_string(), "/a/y.md".to_string()];
        let url = build_window_url_with_files(&files, Some("/a"));
        assert!(url.contains("files="));
        // Files are JSON-encoded so they should contain the array
        assert!(url.contains("x.md"));
        assert!(url.contains("y.md"));
    }

    // -- allocate_window_label ------------------------------------------------

    #[test]
    fn allocate_label_returns_sequential_labels() {
        let l1 = allocate_window_label();
        let l2 = allocate_window_label();
        assert!(l1.starts_with("doc-"));
        assert!(l2.starts_with("doc-"));
        let n1: u32 = l1.strip_prefix("doc-").unwrap().parse().unwrap();
        let n2: u32 = l2.strip_prefix("doc-").unwrap().parse().unwrap();
        assert_eq!(n2, n1 + 1);
    }
}
