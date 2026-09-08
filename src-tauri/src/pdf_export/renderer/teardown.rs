//! The window a platform builds and the caller's timeout closes (#224, #227).
//!
//! Purpose: WebView2 and WebKitGTK expose no way to cancel a print in flight
//! or a navigation still loading — destroying the webview is the one lever.
//! A timeout used to pull nothing: `wait.rs` returned to the caller, and the
//! hidden window lived on at the platform's own pace, or for the life of the
//! app when its callback never came (ADR-PDF7 named the leak; nothing closed
//! it on the timeout path). The platform now arms this with its window's
//! close when it builds the window, and the caller's timeout runs it —
//! `wait.rs` names which timeouts: a render's always, a dialog's only while
//! the platform has not claimed, since after a claim the dialog is the
//! user's. macOS arms nothing: its body is synchronous, drops its window on
//! return, and its claim check is what an abandoned body hits before it
//! prints.
//!
//! Settling DISARMS the hook rather than running it: every platform settle
//! path closes — or deliberately keeps — its own window (Windows leaves a
//! shown print UI's window to the user), and that decision is theirs. An
//! unsettled sink that is dropped runs it, so no path can leak the window.
//!
//! @coordinates-with sink.rs — owns one; settle disarms, Drop runs
//! @coordinates-with wait.rs — runs it on the timeouts named above
//! @coordinates-with windows_nav.rs, linux_nav.rs — arm it with the window's close
//! @module pdf_export/renderer/teardown

use std::sync::Mutex;

type Close = Box<dyn FnOnce() + Send>;

/// What the sink knows about its platform's window.
#[derive(Default)]
enum Slot {
    /// No window yet, and no close asked for.
    #[default]
    Idle,
    /// The platform's close, waiting for a `run` or a `disarm`.
    Armed(Close),
    /// A `run` arrived before any close did — the window was still being
    /// built on the main thread. The NEXT `arm` runs immediately (#447);
    /// forgetting the request left that window open for the life of the app.
    Run,
}

/// One window's close, run at most once — and never dropped on the floor
/// because the request arrived before the window did.
#[derive(Default)]
pub(super) struct Teardown(Mutex<Slot>);

impl Teardown {
    /// The platform's close for the window it just built. One window per
    /// sink, so one arm per sink; a second replaces the first AND closes the
    /// window the first named, rather than dropping it (#448). An arm that
    /// finds a `run` already asked for closes the new window on the spot.
    // macOS arms nothing in production (its body drops its own window), so
    // the host build sees this called from tests alone.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub(super) fn arm(&self, close: impl FnOnce() + Send + 'static) {
        let close: Close = Box::new(close);
        let late = {
            let mut slot = self.slot();
            match &*slot {
                // The timeout already ran: this window has to come down too,
                // and nothing else will ask. Closed below, lock released, so
                // the close cannot re-enter this.
                Slot::Run => Some(close),
                Slot::Armed(_) => {
                    // RELEASE the displaced close, do not drop it (#448). This
                    // was a `debug_assert!(false, ..)`, which is two different
                    // behaviours: a panic in a test build, and in a RELEASE
                    // build the silent discard of the first window's only
                    // close — leaking it for the life of the app, which is the
                    // exact failure this type exists to prevent. One behaviour
                    // in every build, loud in the log and pinned by a test,
                    // beats an assertion that hides the shipped path. Run
                    // below, outside the lock, like the `Run` arm.
                    log::error!("[PDF] a second window was armed on one sink; closing the first");
                    match std::mem::replace(&mut *slot, Slot::Armed(close)) {
                        Slot::Armed(displaced) => Some(displaced),
                        _ => None,
                    }
                }
                Slot::Idle => {
                    *slot = Slot::Armed(close);
                    None
                }
            }
        };
        if let Some(close) = late {
            close();
        }
    }

    /// Close the window now, if armed and not yet run or disarmed. A call on
    /// a sink whose platform has not built its window yet is REMEMBERED, so
    /// the arm that follows closes at once; a second call does nothing.
    pub(super) fn run(&self) {
        let close = match std::mem::replace(&mut *self.slot(), Slot::Run) {
            Slot::Armed(close) => Some(close),
            _ => None,
        };
        if let Some(close) = close {
            close();
        }
    }

    /// Forget the close without running it: the platform settled, and the
    /// window is its own to close or keep. A remembered `run` is NOT
    /// forgotten — a window armed after both still has to come down.
    pub(super) fn disarm(&self) {
        let mut slot = self.slot();
        if matches!(&*slot, Slot::Armed(_)) {
            *slot = Slot::Idle;
        }
    }

    fn slot(&self) -> std::sync::MutexGuard<'_, Slot> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

#[cfg(test)]
#[path = "teardown.test.rs"]
mod tests;
