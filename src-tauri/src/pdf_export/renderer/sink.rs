//! The outcome channel a platform renderer settles.
//!
//! Purpose: split from `mod.rs` for the size limit, and because this is the
//! one piece with real invariants rather than plumbing — settle-once, and
//! settle-on-drop.
//!
//! It is passed IN rather than returned, because two of the three platforms
//! cannot produce a result before the UI closure must return (ADR-PDF6):
//! WebView2 posts completion to the creating thread's message pump and
//! WebKitGTK emits a signal on the owning GLib context. Blocking the closure
//! to wait for either deadlocks the loop that would deliver it.
//!
//! It also owns the temp HTML file, which must outlive NAVIGATION rather than
//! the dispatch that started it (ADR-PDF4).
//!
//! @coordinates-with mod.rs — constructs it
//! @coordinates-with macos_ops.rs, windows.rs, linux.rs — settle it
//! @module pdf_export/renderer/sink

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// The outcome channel a platform body must settle exactly once.
///
/// Passed IN rather than returned, because two of the three platforms cannot
/// produce a result before the UI closure must return (ADR-PDF6): WebView2
/// posts its completion to the creating thread's message pump and WebKitGTK
/// emits a signal on the owning GLib context. Blocking the closure to wait for
/// either one deadlocks the loop that would deliver it.
///
/// The sink also owns the temp HTML file, because it must outlive NAVIGATION,
/// not the dispatch that started it (ADR-PDF4).
pub(crate) struct RenderSink {
    tx: Mutex<Option<oneshot::Sender<Result<(), CommandError>>>>,
    temp_html: PathBuf,
}

impl RenderSink {
    pub(super) fn new(
        tx: oneshot::Sender<Result<(), CommandError>>,
        temp_html: PathBuf,
    ) -> Arc<Self> {
        Arc::new(Self {
            tx: Mutex::new(Some(tx)),
            temp_html,
        })
    }

    /// Deliver the outcome and drop the temp file. A second call is ignored,
    /// so a platform that both returns an error and fires its callback cannot
    /// panic or double-report.
    pub(super) fn settle(&self, result: Result<(), CommandError>) {
        let taken = self.tx.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(tx) = taken {
            let _ = std::fs::remove_file(&self.temp_html);
            let _ = tx.send(result);
        }
    }
}

/// If a platform body is dropped without settling — an unwind, or a callback
/// that never fires and is released — report it immediately instead of making
/// the caller wait out the full timeout for a result that can never arrive.
impl Drop for RenderSink {
    fn drop(&mut self) {
        let taken = self.tx.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(tx) = taken {
            let _ = std::fs::remove_file(&self.temp_html);
            let _ = tx.send(Err(localized_error!(
                ErrorCode::Internal,
                "errors.pdf.abandoned"
            )));
        }
    }
}

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
