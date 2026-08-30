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

use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::page_spec::PageSpec;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use tokio::sync::oneshot;

mod sink;
use sink::RenderSink;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_ops;
#[cfg(target_os = "macos")]
use macos_ops as platform;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
mod windows_print;
#[cfg(target_os = "windows")]
use windows as platform;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod linux;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use linux as platform;

/// Hard ceiling on a single PDF render. The internal print pipeline can wait
/// up to ~60s of run-loop ticks; this is three times that, so a slow render
/// still completes while a wedged one does not leave the user staring at a
/// frozen export forever. (The comment previously said "double", which did not
/// match the value.)
const PDF_OPERATION_TIMEOUT: Duration = Duration::from_secs(180);

/// Progress event payload.
///
/// Only the macOS backend emits progress. Windows and Linux are fully
/// implemented (WI-PDF2.1/3.1) but report nothing between navigation and
/// completion, so the payload is dead code there and the allow is still
/// required. It is a gap in those backends, not a stub — an earlier version of
/// this comment claimed they "refuse before there is any progress to report",
/// which stopped being true when they shipped.
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
    page: PageSpec,
) -> Result<(), CommandError> {
    // Re-validate here, not only in the command. On macOS an NSPrintOperation
    // whose NSPrintJobSavingURL points at a directory that does not exist does
    // NOT fail — AppKit falls back to SPOOLING the document to the default
    // printer. Observed live: four blank pages came out of a real printer
    // while a harness called this function directly with a bad path.
    //
    // The command validates too, so this is defence in depth rather than a
    // duplicate: any caller of the renderer must be unable to print paper by
    // accident, and a wrong path is the single most likely caller mistake.
    super::commands::validate_output_path(&output_path)?;

    // The document is written to a temp file rather than passed inline because
    // wry's `.with_html` caps at 2 MiB and a real export routinely exceeds it
    // (ADR-PDF4).
    //
    // `tempfile` creates with O_EXCL and 0600, which a pid+clock filename plus
    // `fs::write` does not: that name is predictable, so a symlink planted at
    // the path would have been followed, and the document — which can contain
    // the user's entire private note — was written world-readable on a shared
    // /tmp. `into_temp_path()` keeps the file after the handle closes, since
    // the webview opens it by path; RenderSink still owns the deletion.
    let temp_dir = std::env::temp_dir();
    let temp_file = tempfile::Builder::new()
        .prefix("vmark-pdf-export-")
        .suffix(".html")
        .tempfile()
        .map_err(|e| {
            localized_error!(
                ErrorCode::Io,
                "errors.pdf.tempWriteFailed",
                detail = e.to_string()
            )
        })?;
    let temp_html = temp_file.into_temp_path().keep().map_err(|e| {
        localized_error!(
            ErrorCode::Io,
            "errors.pdf.tempWriteFailed",
            detail = e.to_string()
        )
    })?;
    // Blocking I/O for a multi-megabyte document would hold a Tokio worker for
    // the whole write; this command is async precisely so it does not.
    let html_bytes = html.clone();
    let temp_for_write = temp_html.clone();
    tokio::task::spawn_blocking(move || std::fs::write(&temp_for_write, html_bytes))
        .await
        .map_err(|e| {
            localized_error!(
                ErrorCode::Io,
                "errors.pdf.tempWriteFailed",
                detail = e.to_string()
            )
        })?
        .map_err(|e| {
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
    let sink = RenderSink::new(tx, temp_html.clone());

    let sink_clone = sink.clone();
    let app_clone = app.clone();
    let temp_html_str = temp_html.to_string_lossy().to_string();
    let temp_dir_str = temp_dir.to_string_lossy().to_string();
    let output_path_clone = output_path.clone();

    // Use Tauri's event loop dispatch (NOT GCD) — this is critical.
    // GCD dispatch causes WKWebView callback deadlock when spinning NSRunLoop.
    app.run_on_main_thread(move || {
        log::debug!("[PDF] main thread (tao event loop) entered");
        // The platform settles the sink — synchronously on macOS, from a
        // native callback on Windows and Linux. The temp file is dropped by
        // the sink, not here: on the async platforms it is still being read.
        platform::render_on_main_thread(
            &app_clone,
            &temp_html_str,
            &temp_dir_str,
            &output_path_clone,
            page,
            sink_clone,
        );
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
    match tokio::time::timeout(PDF_OPERATION_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(localized_error!(
            ErrorCode::Internal,
            "errors.pdf.channelClosed"
        )),
        Err(_) => {
            // The sink still owns the temp file and drops it when the platform
            // releases it. Removing it here could pull the document out from
            // under a render that is merely slow rather than dead.
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
    let sink = RenderSink::new(tx, temp_html.clone());
    let sink_clone = sink.clone();
    let app_clone = app.clone();
    let temp_html_str = temp_html.to_string_lossy().to_string();
    let temp_dir_str = temp_dir.to_string_lossy().to_string();

    app.run_on_main_thread(move || {
        // Same sink contract as render: macOS settles synchronously because
        // its panel is modal, Windows settles once the dialog has been SHOWN
        // (ShowPrintUI is asynchronous), and Linux settles once the user has
        // DISMISSED the dialog (run_dialog blocks until they respond). None
        // of the three reports what the user chose — that has always been the
        // documented contract here.
        #[cfg(target_os = "windows")]
        windows_print::print_on_main_thread(&app_clone, &temp_html_str, &temp_dir_str, sink_clone);
        #[cfg(not(target_os = "windows"))]
        platform::print_on_main_thread(&app_clone, &temp_html_str, &temp_dir_str, sink_clone);
        let _ = std::fs::remove_file(&temp_html_str);
    })
    .map_err(|e| {
        localized_error!(
            ErrorCode::Internal,
            "errors.pdf.dispatchFailed",
            detail = e.to_string()
        )
    })?;

    match tokio::time::timeout(PDF_OPERATION_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(localized_error!(
            ErrorCode::Internal,
            "errors.pdf.channelClosed"
        )),
        Err(_) => Err(localized_error!(
            ErrorCode::Timeout,
            "errors.pdf.printTimeoutSecs",
            seconds = PDF_OPERATION_TIMEOUT.as_secs()
        )),
    }
}
