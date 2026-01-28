use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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
    const SETTINGS_LABEL: &str = "settings";
    const SETTINGS_WIDTH: f64 = 760.0;
    const SETTINGS_HEIGHT: f64 = 540.0;
    const SETTINGS_MIN_WIDTH: f64 = 600.0;
    const SETTINGS_MIN_HEIGHT: f64 = 400.0;

    // If settings window exists, bring it to front and focus it
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
        return Ok(SETTINGS_LABEL.to_string());
    }

    #[cfg(debug_assertions)]
    eprintln!("[window_manager] Creating new settings window");

    // Create new settings window
    // Note: Don't use .center() here as the window-state plugin may override it.
    // Instead, we build the window visible:false, then set size/position, then show.
    let mut builder = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App("/settings".into()),
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
