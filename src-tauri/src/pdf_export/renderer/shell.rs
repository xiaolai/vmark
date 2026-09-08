//! The shell both renderer paths share (#220): the temp document, the
//! outcome channel, and the main-thread hop.
//!
//! Purpose: `render_pdf` and `print_document` each carried their own copy of
//! writing the temp file, building the sink, converting the paths and
//! dispatching to the main thread — the duplication `mod.rs`'s header warns
//! about, since "two of the three copies end up subtly different". This is
//! the one copy; the two callers keep only what differs (the sink shape and
//! how they wait).
//!
//! @coordinates-with mod.rs — the two callers
//! @coordinates-with sink.rs — what `dispatch` hands the platform body
//! @module pdf_export/renderer/shell

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::AppHandle;

use super::sink::RenderSink;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use tokio::sync::oneshot;

/// Write the document to the render temp file the SINK will own.
///
/// `tempfile` creates with O_EXCL and 0600, which a pid+clock filename plus
/// `fs::write` does not: that name is predictable, so a symlink planted at
/// the path would be followed, and the document — which can contain the
/// user's entire private note — was written world-readable on a shared /tmp.
/// The whole create-and-write runs on a blocking thread (a multi-megabyte
/// document would otherwise hold a Tokio worker), WRITES THROUGH THE OPEN
/// HANDLE rather than reopening the path by name, and only then
/// `into_temp_path().keep()`s the result: `keep()` disables tempfile's RAII
/// cleanup, and calling it before the write meant a failed or cancelled
/// write leaked a partial private document that no one — the RenderSink that
/// owns deletion is constructed only after this returns — would ever remove.
async fn write_render_temp(prefix: &str, html: String) -> Result<std::path::PathBuf, CommandError> {
    fn err(e: impl std::fmt::Display) -> CommandError {
        localized_error!(
            ErrorCode::Io,
            "errors.pdf.tempWriteFailed",
            detail = e.to_string()
        )
    }
    let prefix = prefix.to_string();
    let temp_file =
        tokio::task::spawn_blocking(move || -> Result<tempfile::NamedTempFile, CommandError> {
            use std::io::Write;
            let mut temp_file = tempfile::Builder::new()
                .prefix(&prefix)
                .suffix(".html")
                .tempfile()
                .map_err(err)?;
            temp_file.write_all(html.as_bytes()).map_err(err)?;
            Ok(temp_file)
        })
        .await
        // A `JoinError` is the TASK failing — a panic, or the runtime dropping
        // it — not the filesystem (#440). Reported as `io` it looked like a
        // disk the user could do something about, and `is_retryable` says so;
        // `internal` is the class this crate reserves for a task join failure.
        .map_err(|e| {
            CommandError::internal(format!("the PDF temp-file write did not complete: {e}"))
        })??;
    // Kept only now, on the fully written file — if the await above is
    // cancelled instead, the returned NamedTempFile is dropped and RAII
    // deletes it. The webview opens the kept file by path; the sink deletes
    // it on settle or Drop.
    temp_file.into_temp_path().keep().map_err(err)
}

pub(super) fn dispatch_error(e: impl std::fmt::Display) -> CommandError {
    localized_error!(
        ErrorCode::Internal,
        "errors.pdf.dispatchFailed",
        detail = e.to_string()
    )
}

/// The path as the platforms' URL builders take it — or a typed refusal.
///
/// A non-UTF-8 path cannot reach any native webview here: `NSString` cannot
/// hold one, and `url::Url::from_file_path` on Windows refuses a component
/// that is not `str` (url 2.5.8, `path_to_file_url_segments_windows`). The
/// old `to_string_lossy` handed such a path on with `U+FFFD` in it, and the
/// failure surfaced as a navigation to a file that does not exist — a load
/// error nobody could explain from the message (#226). Refusing here names
/// the path, in the only spelling it has.
pub(super) fn utf8_path(path: &Path) -> Result<&str, CommandError> {
    path.to_str().ok_or_else(|| {
        localized_error!(
            ErrorCode::InvalidInput,
            "errors.pdf.badTempPath",
            path = path.to_string_lossy()
        )
    })
}

/// What a platform entry point receives from the shared shell: the temp
/// document's path and the directory it may read from, both as strings for
/// the platform's URL builders.
pub(super) type Body<T> =
    Box<dyn FnOnce(&AppHandle, &str, &str, Arc<RenderSink<T>>) + Send + 'static>;

/// The shell both paths share (#220): write the document to the temp file the
/// sink will own, build the sink around the outcome channel, and hop to the
/// main thread. Returns the sink (so the caller can abandon it) and the
/// receiver it will settle.
pub(super) async fn dispatch<T: Send + 'static>(
    app: &AppHandle,
    prefix: &str,
    html: String,
    build_sink: impl FnOnce(oneshot::Sender<Result<T, CommandError>>, PathBuf) -> Arc<RenderSink<T>>,
    body: Body<T>,
) -> Result<
    (
        Arc<RenderSink<T>>,
        oneshot::Receiver<Result<T, CommandError>>,
    ),
    CommandError,
> {
    // The document is written to a temp file rather than passed inline because
    // wry's `.with_html` caps at 2 MiB and a real export routinely exceeds it
    // (ADR-PDF4).
    // Checked before anything is written: the temp file's path is this
    // directory plus ASCII, so a directory the webviews cannot name is
    // refused before a document is put in it (#226).
    let temp_dir = std::env::temp_dir();
    let temp_dir_str = utf8_path(&temp_dir)?.to_string();
    let temp_html = write_render_temp(prefix, html).await?;
    let (tx, rx) = oneshot::channel();
    let sink = build_sink(tx, temp_html.clone());

    let sink_for_body = sink.clone();
    let app_for_body = app.clone();
    // After the sink owns the file, so a refusal here is cleaned up by its
    // Drop guard rather than leaking the document.
    let temp_html_str = utf8_path(&temp_html)?.to_string();

    // Use Tauri's event loop dispatch (NOT GCD) — this is critical.
    // GCD dispatch causes WKWebView callback deadlock when spinning NSRunLoop.
    // The platform settles the sink — synchronously on macOS, from a native
    // callback on Windows and Linux. The temp file is dropped by the sink,
    // not here: on the async platforms it is still being read.
    app.run_on_main_thread(move || {
        log::debug!("[PDF] main thread (tao event loop) entered");
        body(&app_for_body, &temp_html_str, &temp_dir_str, sink_for_body);
    })
    .map_err(dispatch_error)?;
    Ok((sink, rx))
}

#[cfg(test)]
#[path = "shell.test.rs"]
mod tests;
