//! Temp-HTML hand-off for the Export PDF window.
//!
//! Purpose: Writes the document's rendered HTML to a temp file inside the app
//! data directory (within the Export PDF window's read-only FS scope), so the
//! window can read megabytes of HTML that would not fit in its URL. The window
//! is the only reader; Print renders in the document window and writes nothing
//! here.
//!
//! Lifetime: `window_manager::pdf_export_window` discards the file when the
//! window that read it is destroyed (`discard_temp_html`); the stale sweep on
//! each write is the backstop for a file whose window never closed cleanly.
//!
//! The filesystem logic is pure over the target directory
//! (`write_temp_html_to_dir`, `discard_temp_html`) so it is unit-testable
//! without an `AppHandle`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::Manager;

/// Reject obviously oversized input (50 MB) before touching the disk.
const MAX_HTML_BYTES: usize = 50 * 1024 * 1024;

/// How long an export temp file may linger before cleanup removes it.
const STALE_AFTER: Duration = Duration::from_secs(3600);

/// Write the Export PDF window's HTML to a temp file and return its path,
/// which the window receives as a URL parameter and reads with `readTextFile`.
///
/// Uses the Tauri app data directory so the path falls within the Export PDF
/// window's FS scope (`$APPDATA/temp/**`).
#[tauri::command]
pub fn write_temp_html(app: tauri::AppHandle, html: String) -> Result<String, String> {
    let dir = temp_html_dir(&app)?;
    write_temp_html_to_dir(&dir, &html).map(|p| p.to_string_lossy().into_owned())
}

/// The directory `write_temp_html` writes into.
pub(crate) fn temp_html_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("temp"))
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))
}

/// Remove one hand-off file once its reader is done with it. Returns whether
/// a file was removed.
///
/// The path comes back from the webview (a window URL parameter), so it is
/// trusted only as far as `write_temp_html` itself could have produced it: a
/// direct child of `dir` named `vmark-export-*.html`. Anything else — another
/// directory, a `..` climb, a different name — is left alone.
pub(crate) fn discard_temp_html(dir: &Path, path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if !(name.starts_with(EXPORT_PREFIX) && name.ends_with(".html")) {
        return false;
    }
    if path.parent() != Some(dir) {
        return false;
    }
    std::fs::remove_file(path).is_ok()
}

/// The name prefix of every file `write_temp_html` creates.
const EXPORT_PREFIX: &str = "vmark-export-";

/// Testable core: size-check the HTML, clean up stale temp files (older than
/// `STALE_AFTER`), and persist the content to a uniquely-named file in `dir`.
pub(crate) fn write_temp_html_to_dir(dir: &Path, html: &str) -> Result<PathBuf, String> {
    use std::io::Write;

    if html.len() > MAX_HTML_BYTES {
        return Err(rust_i18n::t!("errors.core.htmlTooLarge").to_string());
    }

    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create temp directory {}: {}", dir.display(), e))?;

    // Sweep files whose window never discarded them (a crash, a force quit).
    cleanup_stale_temp_files(dir, SystemTime::now() - STALE_AFTER);

    // Use tempfile for kernel-guaranteed unique filename (no PID+time guessability)
    let mut temp = tempfile::Builder::new()
        .prefix(EXPORT_PREFIX)
        .suffix(".html")
        .tempfile_in(dir)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    // Write the content, then keep the file past its handle. Kept, not
    // published: the name does not change, so there is no rename to make
    // durable — and nothing is synced, because the file is a hand-off the
    // export window reads back within seconds and discards when it closes; a
    // crash ends the export it belonged to, and `STALE_AFTER` sweeps it.
    temp.write_all(html.as_bytes())
        .map_err(|e| format!("Failed to write temp HTML file: {}", e))?;
    let (_file, path) = temp
        .keep()
        .map_err(|e| format!("Failed to persist temp file: {}", e))?;
    Ok(path)
}

/// Remove export temp HTML files last modified before `cutoff`. Only `.html`
/// files named `vmark-export-*` — or `print-*`, which an earlier print path
/// wrote here and may have left behind — are touched; the temp dir may hold
/// unrelated app data.
fn cleanup_stale_temp_files(dir: &Path, cutoff: SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with(EXPORT_PREFIX) && !name.starts_with("print-") {
            continue;
        }
        if !name.ends_with(".html") {
            continue;
        }
        if let Ok(meta) = path.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "temp_html.test.rs"]
mod tests;
