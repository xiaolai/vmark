//! Stage progress for a PDF render — one sequence, every platform.
//!
//! Purpose: the vocabulary of the `pdf-export-progress` event and the rule that
//! makes it trustworthy: stages advance in one direction, each fires at most
//! once, and nothing fires after the outcome is settled. Until WI-FL6.2 only
//! the macOS backend emitted anything, so the export dialog on Windows and
//! Linux sat on "Preparing…" until the file appeared — a gap in those
//! backends, not a stub (`pdf-renderer-backends`, F5).
//!
//! Key decisions:
//!   - **The stage is an ENUM, not a `&'static str`.** The frontend maps
//!     stages by string, so a misspelling at one platform's emit site would
//!     have shown the raw key on that platform alone. One spelling here;
//!     `progress.test.rs` pins it against the dialog's `stageKeys` map.
//!   - **The reporter is MONOTONIC.** Windows and Linux settle from native
//!     callbacks whose order the code does not choose — WebKitGTK fires
//!     `finished` after `failed` — so a stage can be reported late or twice.
//!     The reporter drops those, rather than asking every call site to guard.
//!   - **Emission goes through a sink closure**, so the smoke harness and the
//!     unit tests capture the sequence without a webview.
//!   - **Emission is ORDERED without holding a lock across the sink.** The
//!     reporter is `Send + Sync`, so two stages accepted on two threads must
//!     leave in acceptance order (#230) — yet a sink that re-enters the
//!     reporter must not deadlock on a lock held around it (#231). Accepted
//!     stages join a queue under the state lock, and whichever caller finds
//!     the queue idle drains it in order with the lock released; a
//!     re-entrant or concurrent report only enqueues.
//!
//! @coordinates-with sink.rs — owns the reporter and refuses progress once settled
//! @coordinates-with commands.rs — emits `Done` after post-processing
//! @coordinates-with src/export/PdfExportDialog.tsx — the listener's `stageKeys`
//! @module pdf_export/renderer/progress

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

/// The event the export dialog listens for.
pub const PROGRESS_EVENT: &str = "pdf-export-progress";

/// The window that hosts the export dialog — the only listener.
///
/// The payload carries a stage and no job id, and that is correct only
/// because there is never more than one producer: `export_pdf` holds the
/// `ExportGate` (`pdf_export/export_gate.rs`) for its whole run, so a second
/// export is refused rather than started, and two runs can never interleave
/// their stages in this one window (#199).
pub const PROGRESS_WINDOW: &str = "pdf-export";

/// How far a render has got — the `stage` field of every progress event.
///
/// Declared in pipeline order, and `Ord` follows declaration order: that is
/// what lets [`StageTracker`] tell "later" from "again" with a comparison.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum PdfProgress {
    /// The hidden webview is being created and the document loaded into it.
    Loading,
    /// The document has loaded; the native print pipeline is producing pages.
    Rendering,
    /// The PDF exists. `export_pdf` still has the outline and page numbers to
    /// add, which on a long document is visible time.
    Finishing,
    /// Post-processing returned; the file is what the user will open.
    Done,
}

impl PdfProgress {
    /// Every stage, in pipeline order.
    pub const ALL: [PdfProgress; 4] = [
        PdfProgress::Loading,
        PdfProgress::Rendering,
        PdfProgress::Finishing,
        PdfProgress::Done,
    ];

    /// The stages a RENDER emits, in order. `Done` is not among them: it
    /// belongs to `export_pdf`, after post-processing, so the stage the user
    /// sees matches what the file has.
    pub const RENDER: [PdfProgress; 3] = [
        PdfProgress::Loading,
        PdfProgress::Rendering,
        PdfProgress::Finishing,
    ];

    /// The wire spelling — the key the dialog's `stageKeys` map is indexed by.
    pub const fn as_str(self) -> &'static str {
        match self {
            PdfProgress::Loading => "loading",
            PdfProgress::Rendering => "rendering",
            PdfProgress::Finishing => "finishing",
            PdfProgress::Done => "done",
        }
    }
}

/// The wire payload: `{ "stage": "loading" }`. The frontend reads
/// `event.payload.stage`; keep the field name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PdfProgressEvent {
    pub stage: PdfProgress,
}

/// Deliver one stage to the export window.
///
/// `emit_to` a label with no window is a no-op that returns `Ok`, which is
/// what the smoke harness relies on: it has no export window and captures the
/// same emission through `listen_any` instead. A delivery FAILURE is logged
/// with everything needed to place it (#229) — a dialog stuck on "Preparing…"
/// used to be undiagnosable because the emit's result was discarded.
pub fn emit(app: &AppHandle, stage: PdfProgress) {
    if let Err(e) = app.emit_to(PROGRESS_WINDOW, PROGRESS_EVENT, PdfProgressEvent { stage }) {
        log::warn!(
            "[PDF] progress {} could not be delivered to window {PROGRESS_WINDOW:?} as {PROGRESS_EVENT:?}: {e}",
            stage.as_str()
        );
    }
}

/// The pure sequencing rule: forward only, each stage at most once.
#[derive(Debug, Default)]
pub struct StageTracker {
    last: Option<PdfProgress>,
}

impl StageTracker {
    /// Accept `stage` if it is later than everything accepted so far.
    ///
    /// Returns `false` for a repeat and for a regression — both are what a
    /// late native callback looks like, and neither should reach the user.
    pub fn advance(&mut self, stage: PdfProgress) -> bool {
        if self.last.is_some_and(|last| last >= stage) {
            return false;
        }
        self.last = Some(stage);
        true
    }
}

/// Emits stages, in order, through a sink.
///
/// Production builds one with [`ProgressReporter::to_window`]; tests and the
/// smoke harness use [`ProgressReporter::with_sink`] to capture the sequence.
pub struct ProgressReporter {
    sink: Box<dyn Fn(PdfProgress) + Send + Sync>,
    state: Mutex<ReporterState>,
}

#[derive(Default)]
struct ReporterState {
    tracker: StageTracker,
    /// Accepted, not yet handed to the sink — drained in order by one caller.
    queue: VecDeque<PdfProgress>,
    /// A caller is currently draining `queue` with the lock released.
    draining: bool,
    /// The outcome is settled: nothing is accepted any more (`RenderSink`
    /// closes the reporter when it settles).
    closed: bool,
}

impl ProgressReporter {
    /// A reporter that emits to the export window on `app`.
    pub fn to_window(app: AppHandle) -> Self {
        Self::with_sink(move |stage| emit(&app, stage))
    }

    /// A reporter that hands each accepted stage to `sink`.
    pub fn with_sink(sink: impl Fn(PdfProgress) + Send + Sync + 'static) -> Self {
        Self {
            sink: Box::new(sink),
            state: Mutex::new(ReporterState::default()),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, ReporterState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Report `stage`. Returns whether it was accepted — `false` means the
    /// tracker refused it as a repeat or a regression, or the reporter is
    /// closed. An accepted stage reaches the sink in acceptance order: the
    /// sink runs with the lock released, so a sink that reports again (or a
    /// second thread that reports meanwhile) only enqueues, and the caller
    /// already draining delivers it next (#230, #231).
    pub fn report(&self, stage: PdfProgress) -> bool {
        {
            let mut st = self.state();
            if st.closed {
                log::debug!("[PDF] progress {} dropped: settled", stage.as_str());
                return false;
            }
            if !st.tracker.advance(stage) {
                log::debug!(
                    "[PDF] progress {} dropped: out of order or repeated",
                    stage.as_str()
                );
                return false;
            }
            st.queue.push_back(stage);
            if st.draining {
                return true;
            }
            st.draining = true;
        }
        loop {
            let next = {
                let mut st = self.state();
                // Closing while a drain is in flight DISCARDS what is still
                // queued (#438). Without this the drainer kept delivering
                // stages it had accepted before the close — after the outcome
                // had been settled, which is the one thing `close` exists to
                // prevent. Whichever caller is draining checks here, so the
                // stage a second thread enqueued a moment ago is dropped too.
                if st.closed {
                    st.queue.clear();
                    st.draining = false;
                    break;
                }
                match st.queue.pop_front() {
                    Some(next) => next,
                    None => {
                        st.draining = false;
                        break;
                    }
                }
            };
            (self.sink)(next);
        }
        true
    }

    /// No stage is accepted after this: the outcome it would describe has
    /// been delivered. A drain already in flight stops at its next turn of
    /// the loop and discards what is left queued (#438) — an accepted stage
    /// is not a promised one once the result is out.
    pub fn close(&self) {
        let mut st = self.state();
        st.closed = true;
        st.queue.clear();
    }
}

#[cfg(test)]
#[path = "progress.test.rs"]
mod tests;
