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
//!   - Progress is one sequence on every platform (WI-FL6.2): each backend
//!     reports the same three stages through the sink at the equivalent
//!     points of its own pipeline; `progress.rs` owns the vocabulary.
//!   - The print dialog's wait is bounded only until the dialog is SHOWN
//!     (WI-FL6.3). After that the time belongs to the user, and a Print sheet
//!     left open for three minutes is not a timeout.
//!   - A timeout and the platform's irreversible step are decided by ONE
//!     word (#227): the platform claims the sink immediately before it
//!     presents a dialog or starts a print, the caller abandons it when its
//!     wait ends, and exactly one of them wins — `sink.rs`, `wait.rs`.
//!   - A render never writes the output path (#224): the platform writes a
//!     sibling staging file, and only a success DELIVERED to a caller still
//!     waiting is renamed into place — `staging.rs`. A print that completes
//!     after its caller's timeout fills a file the sink then deletes.
//!   - A timeout TEARS DOWN (#224, #227). Neither WebView2 nor WebKitGTK can
//!     cancel a print in flight or a load that hangs; destroying the webview
//!     is the one lever. The platform arms the sink with its window's close
//!     when it builds the window, and the caller's timeout runs it — a
//!     render's always, a dialog's only while the platform has not claimed —
//!     `teardown.rs`, `wait.rs`. macOS arms nothing: its body is synchronous
//!     and drops its own window on return.
//!   - Both paths share one shell — `dispatch` (#220): the temp document,
//!     the outcome channel and the main-thread hop are written once; the two
//!     waits are `wait.rs`'s; this file keeps only what differs.
//!
//! @coordinates-with commands.rs — the only caller
//! @module pdf_export/renderer

use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;

use super::page_spec::PageSpec;
use crate::command_error::CommandError;
use tokio::sync::oneshot;

mod sink;
mod sink_phase;
use sink::RenderSink;

mod shell;
use shell::{dispatch, utf8_path};

mod staging;
mod teardown;
mod wait;

/// The one-shot decision a `NavigationCompleted`-style callback makes; pure,
/// so it is tested on every platform although only Windows drives it.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod navigation;

pub mod outcome;
pub use outcome::PrintOutcome;

pub mod progress;
use progress::ProgressReporter;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_ops;
#[cfg(target_os = "macos")]
mod macos_print;
#[cfg(target_os = "macos")]
mod macos_save_job;
#[cfg(target_os = "macos")]
use macos_ops as platform;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
mod windows_nav;
#[cfg(target_os = "windows")]
mod windows_print;
#[cfg(target_os = "windows")]
use windows as platform;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod linux;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod linux_nav;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod linux_print;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use linux as platform;

/// Hard ceiling on a single PDF render. The internal print pipeline can wait
/// up to ~60s of run-loop ticks; this is three times that, so a slow render
/// still completes while a wedged one does not leave the user staring at a
/// frozen export forever. (The comment previously said "double", which did not
/// match the value.)
const PDF_OPERATION_TIMEOUT: Duration = Duration::from_secs(180);

// ============================================================================
// PDF Export
// ============================================================================

/// Render HTML to PDF via an off-screen native webview.
///
/// Writes HTML to a temp file, then dispatches to the main thread via
/// Tauri's event loop to create the webview and generate the PDF. The three
/// render stages go to the export window as `pdf-export-progress` events on
/// every platform; the caller emits `done` after its own post-processing.
///
/// Safe to run concurrently for DIFFERENT outputs — the smoke harness does —
/// because each render stages beside its own output. `export_pdf` is what
/// serializes exports, for the sake of the one progress window (#198, #199).
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
    // The staging file AppKit is actually handed is a sibling of this path,
    // so the directory it lands in is the one validated here.
    super::commands::validate_output_path(&output_path)?;
    // And the GEOMETRY, for the same reason and by the same argument (#403).
    // `export_pdf` validates it; a caller that reaches the renderer directly
    // — the pdf-smoke harness does, three times — does not, and a NaN or a
    // negative extent then reaches `NSPrintInfo::setPaperSize`,
    // `ICoreWebView2PrintSettings` or `gtk::PaperSize::new_custom` as a
    // native value nothing downstream checks.
    page.validate()?;
    log::debug!(
        "[PDF] render_pdf: {} bytes of HTML, output: {}",
        html.len(),
        output_path
    );
    let output = PathBuf::from(&output_path);
    let staging = staging::staging_path_for(&output);
    let target = utf8_path(&staging)?.to_string();

    let reporter = ProgressReporter::to_window(app.clone());
    let staging_for_sink = staging.clone();
    let (sink, rx) = dispatch(
        &app,
        "vmark-pdf-export-",
        html,
        move |tx, temp_html| RenderSink::with_progress(tx, temp_html, staging_for_sink, reporter),
        Box::new(move |app, temp_html, temp_dir, sink| {
            platform::render_on_main_thread(app, temp_html, temp_dir, &target, page, sink);
        }),
    )
    .await?;

    wait::settle_render(&sink, rx, &staging, &output, PDF_OPERATION_TIMEOUT).await
}

/// Print HTML via the platform's native print dialog.
///
/// Same pipeline as `render_pdf` but shows the print panel instead of
/// silently saving to a file, and resolves with what the dialog reported:
/// `completed` or `cancelled` where the platform says (macOS, Linux),
/// `unknown` where it does not (Windows) — see `outcome.rs`.
///
/// `parent_label` names the window the command was invoked from; macOS
/// attaches its print sheet to THAT window rather than to whichever window
/// happens to be key once the document has loaded (#218). The other two
/// platforms present their own window and ignore it.
pub async fn print_document(
    app: AppHandle,
    html: String,
    parent_label: Option<String>,
) -> Result<PrintOutcome, CommandError> {
    let (shown_tx, shown_rx) = oneshot::channel::<()>();
    #[cfg(not(target_os = "macos"))]
    let _ = &parent_label;
    let (sink, rx) = dispatch(
        &app,
        "vmark-print-",
        html,
        move |tx, temp_html| RenderSink::for_dialog(tx, shown_tx, temp_html),
        Box::new(move |app, temp_html, temp_dir, sink| {
            // Same sink contract as render, one phase richer: each platform
            // claims the sink, calls `shown()` once its dialog is up, then
            // settles with the outcome — macOS from the print operation's
            // delegate when the sheet ends, Linux on cancel or on the
            // confirmed job's finished/failed signal (#1343), Windows
            // immediately after ShowPrintUI, which reports nothing further.
            #[cfg(target_os = "windows")]
            windows_print::print_on_main_thread(app, temp_html, temp_dir, sink);
            #[cfg(target_os = "macos")]
            macos_print::print_on_main_thread(
                app,
                temp_html,
                temp_dir,
                parent_label.as_deref(),
                sink,
            );
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            linux_print::print_on_main_thread(app, temp_html, temp_dir, sink);
        }),
    )
    .await?;

    wait::await_dialog(&sink, shown_rx, rx, PDF_OPERATION_TIMEOUT).await
}
