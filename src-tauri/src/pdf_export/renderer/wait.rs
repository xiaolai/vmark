//! How the two callers wait for the platform — and what a timeout means to
//! each (#220, #221, #225).
//!
//! Purpose: `render_pdf` and `print_document` each carried a copy of the
//! bounded wait, the closed-channel mapping and the timeout error, and each
//! embedded what to do next. This is the one copy of the plumbing, with the
//! two policies named:
//!   - a **render** is bounded end to end; past the bound the caller reports
//!     a timeout, the platform's window comes down at once, and its late
//!     result, if any, is discarded rather than published (#224);
//!   - a **dialog** is bounded only until it is SHOWN (WI-FL6.3); past that
//!     bound the caller asks the sink who won (#227) — a platform that
//!     claimed the dialog first has it on screen, and a timeout reported over
//!     a live sheet would be a lie the user then disproves by clicking Print;
//!     a platform that had NOT claimed gets its window closed now.
//!
//! A timeout is not cancellation on any platform — neither WebView2 nor
//! WebKitGTK can stop a print in flight or a load that hangs — so the
//! teardown is what a timeout DOES: the close the platform armed the sink
//! with (`teardown.rs`) is run here, and whatever the platform still writes
//! is a file the sink discards on arrival.
//!
//! @coordinates-with mod.rs — the two callers
//! @coordinates-with sink.rs — `abandon` is the atomic half of each policy
//! @coordinates-with teardown.rs — the close a timeout runs
//! @coordinates-with staging.rs — what a delivered render success publishes
//! @module pdf_export/renderer/wait

use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::sync::oneshot;

use super::sink::{Abandoned, RenderSink};
use super::staging::{publish, remove_temp};
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

type OutcomeRx<T> = oneshot::Receiver<Result<T, CommandError>>;

/// The bound as a WHOLE number of seconds for the message a timeout carries.
///
/// `Duration::as_secs()` truncates (#452), so every sub-second bound reported
/// "0 seconds" — a message that names no bound at all, and the one a test
/// driving a 200 ms wait prints. Rounding UP keeps the number an upper bound on
/// what was actually waited, which is what the sentence claims; only a bound of
/// exactly zero reports zero.
fn bound_seconds(bound: Duration) -> u64 {
    bound.as_secs() + u64::from(bound.subsec_nanos() > 0)
}

/// `Some` if `fut` completed within `bound`, `None` if the bound elapsed
/// first. On elapse the future — and the receiver it owns — is dropped.
async fn within<F: Future>(bound: Duration, fut: F) -> Option<F::Output> {
    tokio::time::timeout(bound, fut).await.ok()
}

/// The outcome the platform settled. A channel closed without a value — a
/// platform closure that unwound before reaching its `settle` — is reported
/// as such rather than left to hang the caller.
async fn await_outcome<T>(rx: OutcomeRx<T>) -> Result<T, CommandError> {
    match rx.await {
        Ok(result) => result,
        Err(_) => Err(localized_error!(
            ErrorCode::Internal,
            "errors.pdf.channelClosed"
        )),
    }
}

/// A render: wait out `bound`, then publish the staging file onto `output`
/// on a delivered success. On a timeout the render is abandoned and the
/// platform's window torn down — the sink discards whatever the platform
/// still writes — and, if the outcome had slipped in just before the
/// caller's clock ran out, the file that delivery left behind is removed
/// here, since nobody will read it.
pub(super) async fn settle_render(
    sink: &RenderSink,
    rx: OutcomeRx<()>,
    staging: &Path,
    output: &Path,
    bound: Duration,
) -> Result<(), CommandError> {
    match within(bound, await_outcome(rx)).await {
        Some(Ok(())) => publish_off_thread(staging, output).await,
        // The sink removed the staging file with the `Err`.
        Some(Err(e)) => Err(e),
        None => {
            match sink.abandon() {
                Abandoned::Settled => remove_temp(staging),
                // Still loading, or printing into a file nobody will read:
                // the window comes down NOW (#224), not at the platform's
                // own pace — and not never, when its callback never comes.
                Abandoned::Marked | Abandoned::Claimed => sink.teardown.run(),
            }
            // A distinct CODE, not a recognisable message: the frontend must
            // be able to tell a timeout from an I/O failure without matching
            // text (rule 50).
            Err(localized_error!(
                ErrorCode::Timeout,
                "errors.pdf.exportTimeout",
                seconds = bound_seconds(bound)
            ))
        }
    }
}

/// `publish`, on the blocking pool (#451).
///
/// The rename's destination is the path the USER picked in a save dialog, which
/// can be a network mount or an external disk; a `rename` there can block for
/// as long as the filesystem takes. The bound above covers the render, not
/// this, so running it inline held a Tokio worker for a wait nothing measured
/// — the same reason `shell.rs` writes the temp document on the blocking pool.
///
/// Deliberately NOT given a deadline of its own: a rename cannot be cancelled,
/// and abandoning the wait would leave the caller unable to say whether the
/// output was replaced. What this buys is that the WAIT is not an async
/// worker's; a `JoinError` here is the task failing, never the filesystem.
async fn publish_off_thread(staging: &Path, output: &Path) -> Result<(), CommandError> {
    let (staging, output): (PathBuf, PathBuf) = (staging.to_path_buf(), output.to_path_buf());
    match tokio::task::spawn_blocking(move || publish(&staging, &output)).await {
        Ok(result) => result,
        Err(e) => Err(CommandError::internal(format!(
            "the PDF publish did not complete: {e}"
        ))),
    }
}

/// A dialog: bounded until shown, unbounded after. The bounded phase also
/// ends when the platform settles first — a failed load, a COM error,
/// Windows's immediate settle — because settling closes `shown`.
///
/// When the bound elapses, the sink says who won (#227): `Marked` means the
/// platform had not reached its dialog — its window is closed here and now,
/// and a claim it makes after this is refused and tears down too, either
/// close a no-op after the other — so this is a real timeout; `Claimed`
/// means the dialog is on screen or about to be, so the time is the user's;
/// `Settled` means the outcome is already waiting.
pub(super) async fn await_dialog<T>(
    sink: &RenderSink<T>,
    shown_rx: oneshot::Receiver<()>,
    rx: OutcomeRx<T>,
    bound: Duration,
) -> Result<T, CommandError> {
    if within(bound, shown_rx).await.is_none() {
        match sink.abandon() {
            Abandoned::Marked => {
                sink.teardown.run();
                return Err(localized_error!(
                    ErrorCode::Timeout,
                    "errors.pdf.printTimeoutSecs",
                    seconds = bound_seconds(bound)
                ));
            }
            Abandoned::Claimed | Abandoned::Settled => {}
        }
    }
    await_outcome(rx).await
}

#[cfg(test)]
#[path = "wait.test.rs"]
mod tests;
