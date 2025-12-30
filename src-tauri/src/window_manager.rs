use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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


/// Create a new document window with optional file path
/// Returns the window label on success
pub fn create_document_window(
    app: &AppHandle,
    file_path: Option<&str>,
) -> Result<String, tauri::Error> {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("doc-{}", count);

    // Build URL with optional file path query param
    let url = match file_path {
        Some(path) => format!("/?file={}", urlencoding::encode(path)),
        None => "/".to_string(),
    };

    let title = match file_path {
        Some(path) => {
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Untitled");
            format!("{} - VMark", filename)
        }
        None => "Untitled - VMark".to_string(),
    };

    // Get cascaded position (always use minimum size for new windows)
    let (x, y) = get_cascaded_position(count);

    // CRITICAL: Full window configuration for proper macOS behavior
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(MIN_WIDTH, MIN_HEIGHT)
        .min_inner_size(800.0, 600.0)
        .position(x, y)
        .resizable(true)
        .fullscreen(false)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .focused(true);

    // macOS-specific: accept first mouse click for better UX
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    builder.build()?;

    Ok(label)
}

/// Create a new empty window (Tauri command)
#[tauri::command]
pub fn new_window(app: AppHandle) -> Result<String, String> {
    create_document_window(&app, None).map_err(|e| e.to_string())
}

/// Open a file in a new window (Tauri command)
#[tauri::command]
pub fn open_file_in_new_window(app: AppHandle, path: String) -> Result<String, String> {
    create_document_window(&app, Some(&path)).map_err(|e| e.to_string())
}

/// Close a specific window by label
#[tauri::command]
pub fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.destroy().map_err(|e| e.to_string())
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
