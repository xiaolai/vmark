//! Temp-HTML writer for browser-based printing and PDF export.
//!
//! Purpose: Writes export HTML to a temp file inside the app data directory
//! (within the FS plugin's allowed scope) and cleans up stale temp files.
//! Extracted verbatim from `lib.rs` to keep that file under the size gate.
//! The filesystem logic lives in `write_temp_html_to_dir` (pure over the
//! target directory) so it is unit-testable without an `AppHandle`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::Manager;

/// Reject obviously oversized input (50 MB) before touching the disk.
const MAX_HTML_BYTES: usize = 50 * 1024 * 1024;

/// How long an export temp file may linger before cleanup removes it.
const STALE_AFTER: Duration = Duration::from_secs(3600);

/// Write HTML content to a temp file for browser-based printing and PDF export.
/// Returns the file path so the frontend can open it via plugin-opener or read it back.
///
/// Uses the Tauri app data directory so the path falls within the FS plugin's
/// allowed scope (needed for PDF export window to read the file via `readTextFile`).
#[tauri::command]
pub fn write_temp_html(app: tauri::AppHandle, html: String) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    write_temp_html_to_dir(&app_data.join("temp"), &html).map(|p| p.to_string_lossy().into_owned())
}

/// Testable core: size-check the HTML, clean up stale temp files (older than
/// `STALE_AFTER`), and persist the content to a uniquely-named file in `dir`.
pub(crate) fn write_temp_html_to_dir(dir: &Path, html: &str) -> Result<PathBuf, String> {
    use std::io::Write;

    if html.len() > MAX_HTML_BYTES {
        return Err(rust_i18n::t!("errors.core.htmlTooLarge").to_string());
    }

    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create temp directory {}: {}", dir.display(), e))?;

    // Clean up stale temp files to prevent accumulation from previous
    // export/print sessions.
    cleanup_stale_temp_files(dir, SystemTime::now() - STALE_AFTER);

    // Use tempfile for kernel-guaranteed unique filename (no PID+time guessability)
    let mut temp = tempfile::Builder::new()
        .prefix("vmark-export-")
        .suffix(".html")
        .tempfile_in(dir)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    // Write content first, then persist (keep on disk after handle drops)
    temp.write_all(html.as_bytes())
        .map_err(|e| format!("Failed to write temp HTML file: {}", e))?;
    let path = temp.path().to_path_buf();
    temp.persist(&path)
        .map_err(|e| format!("Failed to persist temp file: {}", e))?;
    Ok(path)
}

/// Remove export temp HTML files last modified before `cutoff`. Only files
/// matching the export naming pattern (`vmark-export-*` / `print-*`, `.html`)
/// are touched — the temp dir may hold unrelated app data.
fn cleanup_stale_temp_files(dir: &Path, cutoff: SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("vmark-export-") && !name.starts_with("print-") {
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
