//! PDF renderer — platform-neutral shell over three native backends.
//!
//! Purpose: owns everything that is NOT platform-specific about producing a
//! PDF — the temp HTML file, the main-thread dispatch, the oneshot that
//! carries the result back, the timeout, and cleanup. Each platform module
//! implements only the part that must touch a native webview.
//!
//! Why the shell is shared: it was already written once for macOS and is
//! correct there. Triplicating the timeout and the temp-file cleanup is how
//! two of the three copies end up subtly different.
//!
//! Key decisions:
//!   - HTML reaches the webview as a FILE URL, never as a string. wry's
//!     `.with_html` is `NavigateToString` underneath with a 2 MiB limit, and
//!     VMark inlines images as data URIs, so real exports exceed it
//!     (ADR-PDF4). The temp file must outlive navigation, not the dispatch.
//!   - `run_on_main_thread` (tao event loop), never GCD — GCD dispatch
//!     deadlocks WKWebView callbacks when NSRunLoop is spun inside them.
//!   - The wait is BOUNDED. If a platform closure unwinds before sending, the
//!     receiver would otherwise hang the calling async task forever.
//!
//! @coordinates-with commands.rs — the only caller
//! @module pdf_export/renderer

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use tokio::sync::oneshot;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_ops;
#[cfg(target_os = "macos")]
use macos_ops as platform;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as platform;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod linux;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use linux as platform;

/// Hard ceiling on a single PDF render. The internal print pipeline can wait
/// up to ~60s of run-loop ticks; double that to give the dispatcher headroom
/// without leaving the user staring at a frozen export forever.
const PDF_OPERATION_TIMEOUT: Duration = Duration::from_secs(180);

/// Progress event payload.
///
/// Only the macOS backend reports progress so far; the Windows and Linux
/// stubs refuse before there is any progress to report. The allow disappears
/// on its own once those backends call `emit_progress` (WI-PDF2.1/3.1) —
/// it is inert rather than wrong in the meantime.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, serde::Serialize)]
struct PdfProgress {
    stage: &'static str,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn emit_progress(app: &AppHandle, stage: &'static str) {
    let _ = app.emit_to("pdf-export", "pdf-export-progress", PdfProgress { stage });
}

// ============================================================================
// PDF Export
// ============================================================================

/// Render HTML to PDF via off-screen WKWebView.
///
/// Writes HTML to a temp file, then dispatches to the main thread via
/// Tauri's event loop to create a WKWebView and generate the PDF.
pub async fn render_pdf(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), CommandError> {
    // Write HTML to temp file on the async thread (no main thread needed)
    let temp_dir = std::env::temp_dir();
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_html = temp_dir.join(format!(
        "vmark-pdf-export-{}-{}.html",
        std::process::id(),
        unique_id
    ));
    std::fs::write(&temp_html, &html).map_err(|e| {
        localized_error!(
            ErrorCode::Io,
            "errors.pdf.tempWriteFailed",
            detail = e.to_string()
        )
    })?;

    log::debug!(
        "[PDF] render_pdf: wrote {} bytes to {}, output: {}",
        html.len(),
        temp_html.display(),
        output_path
    );

    let (tx, rx) = oneshot::channel::<Result<(), CommandError>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    let tx_clone = tx.clone();
    let app_clone = app.clone();
    let temp_html_str = temp_html.to_string_lossy().to_string();
    let temp_dir_str = temp_dir.to_string_lossy().to_string();
    let output_path_clone = output_path.clone();

    // Use Tauri's event loop dispatch (NOT GCD) — this is critical.
    // GCD dispatch causes WKWebView callback deadlock when spinning NSRunLoop.
    app.run_on_main_thread(move || {
        log::debug!("[PDF] main thread (tao event loop) entered");
        let result = platform::render_on_main_thread(
            &app_clone,
            &temp_html_str,
            &temp_dir_str,
            &output_path_clone,
        );
        log::debug!("[PDF] done, result: {:?}", result.as_ref().map(|_| "ok"));
        // Clean up temp file
        let _ = std::fs::remove_file(&temp_html_str);
        if let Some(sender) = tx_clone.lock().unwrap_or_else(|p| p.into_inner()).take() {
            let _ = sender.send(result);
        }
    })
    .map_err(|e| {
        localized_error!(
            ErrorCode::Internal,
            "errors.pdf.dispatchFailed",
            detail = e.to_string()
        )
    })?;

    // Bound the wait. If the main-thread dispatch panics or never runs the
    // sender (e.g. because the run_on_main_thread closure unwound before
    // reaching the `sender.send(...)` line), the receiver would otherwise
    // wait forever and freeze the calling async task.
    let temp_html_for_cleanup = temp_html.clone();
    match tokio::time::timeout(PDF_OPERATION_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(localized_error!(
            ErrorCode::Internal,
            "errors.pdf.channelClosed"
        )),
        Err(_) => {
            // Timed out — clean up the temp file the main thread never reached.
            let _ = std::fs::remove_file(&temp_html_for_cleanup);
            // A distinct CODE, not a recognisable message: the frontend must
            // be able to tell a timeout from an I/O failure without matching
            // text (rule 50).
            Err(localized_error!(
                ErrorCode::Timeout,
                "errors.pdf.exportTimeout",
                seconds = PDF_OPERATION_TIMEOUT.as_secs()
            ))
        }
    }
}

/// Print HTML via the platform's native print dialog.
///
/// Same pipeline as `render_pdf` but shows the print panel instead of
/// silently saving to a file. The user selects a printer and prints.
pub async fn print_document(app: AppHandle, html: String) -> Result<(), CommandError> {
    let temp_dir = std::env::temp_dir();
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_html = temp_dir.join(format!(
        "vmark-print-{}-{}.html",
        std::process::id(),
        unique_id
    ));
    std::fs::write(&temp_html, &html).map_err(|e| {
        localized_error!(
            ErrorCode::Io,
            "errors.pdf.tempWriteFailed",
            detail = e.to_string()
        )
    })?;

    let (tx, rx) = oneshot::channel::<Result<(), CommandError>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx_clone = tx.clone();
    let temp_html_str = temp_html.to_string_lossy().to_string();
    let temp_dir_str = temp_dir.to_string_lossy().to_string();

    app.run_on_main_thread(move || {
        let result = platform::print_on_main_thread(&temp_html_str, &temp_dir_str);
        let _ = std::fs::remove_file(&temp_html_str);
        if let Some(sender) = tx_clone.lock().unwrap_or_else(|p| p.into_inner()).take() {
            let _ = sender.send(result);
        }
    })
    .map_err(|e| {
        localized_error!(
            ErrorCode::Internal,
            "errors.pdf.dispatchFailed",
            detail = e.to_string()
        )
    })?;

    let temp_html_for_cleanup = temp_html.clone();
    match tokio::time::timeout(PDF_OPERATION_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(localized_error!(
            ErrorCode::Internal,
            "errors.pdf.channelClosed"
        )),
        Err(_) => {
            let _ = std::fs::remove_file(&temp_html_for_cleanup);
            Err(localized_error!(
                ErrorCode::Timeout,
                "errors.pdf.printTimeoutSecs",
                seconds = PDF_OPERATION_TIMEOUT.as_secs()
            ))
        }
    }
}
