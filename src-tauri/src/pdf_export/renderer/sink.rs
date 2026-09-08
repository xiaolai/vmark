//! The outcome channel a platform renderer settles.
//!
//! Purpose: split from `mod.rs` for the size limit, and because this is the
//! one piece with real invariants rather than plumbing — settle-once,
//! settle-on-drop, and (since WI-FL6.2) no progress after settling.
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
//! Five additions ride on the same settle-once guarantee:
//!   - **Progress** goes through the sink, so a stage reported after the
//!     outcome — WebKitGTK's `finished` after `failed` — is dropped: settling
//!     CLOSES the reporter under the outcome lock, and the reporter refuses
//!     what arrives after. ABANDONING closes it too (#457): the caller's
//!     timeout has already reported failure, so a platform callback arriving
//!     afterwards must not move the export dialog on to "finishing". The
//!     reporter itself runs with that lock released (#231), so a sink closure
//!     that re-enters the sink cannot deadlock. Call sites do not guard.
//!   - **A `shown` phase**, for the print dialog only. Everything up to the
//!     dialog is the app's own work and is bounded by a timeout; everything
//!     after it is the user's time and is not (WI-FL6.3). Settling closes the
//!     phase too, so a failure before the dialog never waits out the bound.
//!   - **A claim, atomic with abandonment AND with settlement** (#227, #443,
//!     #444 — all three take the outcome lock). A timeout in `wait.rs`
//!     returns to the caller, but the platform work continues on the main
//!     thread or in a native callback. The platform [`claim`](RenderSink::claim)s
//!     the sink immediately before its irreversible step — presenting a
//!     dialog, starting a print — and the caller [`abandon`](RenderSink::abandon)s
//!     it when its wait ends. Both are one compare-and-swap on one word, so
//!     exactly one of them wins: a platform that loses tears down instead of
//!     presenting a dialog for a command that already reported failure, and a
//!     caller that loses learns the dialog IS (about to be) on screen and
//!     keeps waiting rather than report a timeout over a live sheet.
//!   - **The staging file** (#224). A render writes a sibling of the output,
//!     never the output; the caller publishes it on a DELIVERED `Ok`, and the
//!     sink removes it in every other case — an `Err`, a delivery nobody
//!     received because the caller had given up, an abandoned sink — so a
//!     print that completes after its caller's timeout leaves nothing behind
//!     and never touches the path a retry is writing.
//!   - **The teardown** (#224, #227). A platform that builds a window arms
//!     the sink with its close; the caller's timeout runs it (`wait.rs` says
//!     which timeouts), settling disarms it, and an unsettled Drop runs it —
//!     `teardown.rs`. A timeout used to leave the window at the platform's
//!     own pace, or forever.
//!
//! @coordinates-with wait.rs — awaits `shown` then the outcome; abandons and tears down on timeout
//! @coordinates-with staging.rs — the file the render path stages, and `remove_temp`
//! @coordinates-with teardown.rs — the close the timeout runs
//! @coordinates-with progress.rs — the reporter this owns
//! @coordinates-with sink_phase.rs — the claim/abandon word
//! @coordinates-with macos_ops.rs, macos_print.rs, windows_nav.rs, linux_nav.rs, linux.rs, linux_print.rs — claim and settle it
//! @module pdf_export/renderer/sink

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;

use super::progress::{PdfProgress, ProgressReporter};
pub(super) use super::sink_phase::Abandoned;
use super::sink_phase::Phase;
use super::staging::remove_temp;
use super::teardown::Teardown;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

type Outcome<T> = Result<T, CommandError>;

/// The outcome channel a platform body must settle exactly once.
///
/// `T` is `()` for a render and `PrintOutcome` for the dialog — the same
/// lifecycle, one value apart.
pub(crate) struct RenderSink<T = ()> {
    tx: Mutex<Option<oneshot::Sender<Outcome<T>>>>,
    /// Print path only. Closed by [`shown`](Self::shown) once the dialog is
    /// up, or by settling — either ends the bounded phase.
    shown: Mutex<Option<oneshot::Sender<()>>>,
    /// Render path only. `None` on the print path, where the dialog is the
    /// progress.
    progress: Option<ProgressReporter>,
    /// The one word `claim` and `abandon` race on — `sink_phase.rs` (#227).
    phase: Phase,
    temp_html: PathBuf,
    /// Render path only: the file the platform writes (#224). Kept for the
    /// caller to publish on a delivered `Ok`; removed here otherwise.
    staging: Option<PathBuf>,
    /// The platform's window close, for the caller's timeout (#224, #227).
    pub(super) teardown: Teardown,
}

impl<T> RenderSink<T> {
    /// The render path: stages go out through `progress` until settled, and
    /// the platform writes `staging`, which the caller publishes.
    pub(super) fn with_progress(
        tx: oneshot::Sender<Outcome<T>>,
        temp_html: PathBuf,
        staging: PathBuf,
        progress: ProgressReporter,
    ) -> Arc<Self> {
        Self::build(tx, Some(progress), None, temp_html, Some(staging))
    }

    /// The dialog path: `shown` fires when the dialog is up.
    pub(super) fn for_dialog(
        tx: oneshot::Sender<Outcome<T>>,
        shown: oneshot::Sender<()>,
        temp_html: PathBuf,
    ) -> Arc<Self> {
        Self::build(tx, None, Some(shown), temp_html, None)
    }

    fn build(
        tx: oneshot::Sender<Outcome<T>>,
        progress: Option<ProgressReporter>,
        shown: Option<oneshot::Sender<()>>,
        temp_html: PathBuf,
        staging: Option<PathBuf>,
    ) -> Arc<Self> {
        Arc::new(Self {
            tx: Mutex::new(Some(tx)),
            shown: Mutex::new(shown),
            progress,
            phase: Phase::default(),
            temp_html,
            staging,
            teardown: Teardown::default(),
        })
    }

    /// Report a stage — only while the outcome is still pending, and only
    /// forward (see `ProgressReporter`). A no-op on a sink built without a
    /// reporter.
    ///
    /// The pending check is made under the outcome lock and the lock is
    /// released BEFORE the reporter runs (#231); a settle racing this call
    /// closes the reporter under that same lock, so the stage is refused
    /// there rather than let out after the result.
    pub(super) fn progress(&self, stage: PdfProgress) {
        let pending = self.tx.lock().unwrap_or_else(|p| p.into_inner()).is_some();
        if pending {
            if let Some(reporter) = &self.progress {
                reporter.report(stage);
            }
        }
    }

    /// The platform is about to do the irreversible thing — present a dialog,
    /// start a print. `true` once, and never after the caller abandoned: the
    /// same word `abandon` writes, so the two cannot both succeed (#227).
    /// Never after the outcome was delivered either — there is nothing left
    /// to present a dialog for.
    ///
    /// The settled check and the swap are ONE critical section under the
    /// outcome lock (#443): separated, a `settle` between them left this
    /// returning `true`, and the platform then presented a dialog — or
    /// printed into a staging file the settle had discarded — for a command
    /// that had already reported its outcome.
    pub(super) fn claim(&self) -> bool {
        let pending = self.tx.lock().unwrap_or_else(|p| p.into_inner());
        pending.is_some() && self.phase.claim()
    }

    /// The caller has stopped waiting (a phase timeout). Tells the caller what
    /// the platform had done by then, so it can act on the truth rather than
    /// on the clock: a dialog that won the race is on screen and is waited
    /// for; an outcome that was already delivered is not lost.
    ///
    /// Same one critical section as `claim` (#444): separated, a settle in
    /// between made this report `Marked` — "nothing was delivered" — over a
    /// success the caller was about to receive.
    pub(super) fn abandon(&self) -> Abandoned {
        // Settled is checked FIRST: a delivery that beat the caller's clock is
        // the case where the caller must clean up what it never received.
        let pending = self.tx.lock().unwrap_or_else(|p| p.into_inner());
        if pending.is_none() {
            return Abandoned::Settled;
        }
        // Nobody is waiting for a stage any more (#457): a callback that
        // arrives after the caller's timeout used to report `Finishing` for a
        // render the command had already failed. Closed under the SAME lock
        // `settle` closes it under, so a `progress` call that has just passed
        // its pending check is refused by the reporter.
        if let Some(reporter) = &self.progress {
            reporter.close();
        }
        self.phase.abandon()
    }

    /// The dialog is on screen. Ends the bounded phase; a second call, or a
    /// call on a sink built without the phase, does nothing.
    pub(super) fn shown(&self) {
        let taken = self.shown.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(tx) = taken {
            let _ = tx.send(());
        }
    }

    /// Deliver the outcome and drop the temp file. A second call is ignored,
    /// so a platform that both returns an error and fires its callback cannot
    /// panic or double-report.
    ///
    /// The staging file survives only a DELIVERED `Ok` to a caller still
    /// waiting — that caller publishes it. An `Err`, a receiver that has gone
    /// away, or an abandoned sink all remove it here (#224).
    pub(super) fn settle(&self, result: Outcome<T>) {
        let (taken, abandoned) = {
            let mut pending = self.tx.lock().unwrap_or_else(|p| p.into_inner());
            let taken = pending.take();
            if taken.is_some() {
                // Under the outcome lock, so a progress call that passed its
                // pending check a moment ago is refused by the reporter.
                if let Some(reporter) = &self.progress {
                    reporter.close();
                }
            }
            // Read in the SAME critical section as the take: the
            // linearization point, past which `abandon` cannot swap the
            // phase (#443, #444).
            (taken, self.phase.is_abandoned())
        };
        if let Some(tx) = taken {
            // Dropping the sender closes `shown` — a settle before the dialog
            // (a load failure, a COM error) must not wait out the bound.
            drop(self.shown.lock().unwrap_or_else(|p| p.into_inner()).take());
            // The window is the platform's to close or keep from here.
            self.teardown.disarm();
            remove_temp(&self.temp_html);
            let succeeded = result.is_ok();
            let delivered = tx.send(result).is_ok();
            if !(succeeded && delivered) || abandoned {
                self.discard_staging();
            }
        }
    }

    fn discard_staging(&self) {
        if let Some(staging) = &self.staging {
            remove_temp(staging);
        }
    }
}

/// If a platform body is dropped without settling — an unwind, or a callback
/// that never fires and is released — report it immediately instead of making
/// the caller wait out the full timeout for a result that can never arrive.
impl<T> Drop for RenderSink<T> {
    fn drop(&mut self) {
        let taken = self.tx.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(reporter) = &self.progress {
            reporter.close();
        }
        if let Some(tx) = taken {
            remove_temp(&self.temp_html);
            self.discard_staging();
            // Unsettled with a window still armed: nothing else will close it.
            self.teardown.run();
            let _ = tx.send(Err(localized_error!(
                ErrorCode::Internal,
                "errors.pdf.abandoned"
            )));
        }
        // `shown` is dropped with the struct, which closes it too.
    }
}

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;

#[cfg(test)]
#[path = "sink_phase.test.rs"]
mod phase_tests;
