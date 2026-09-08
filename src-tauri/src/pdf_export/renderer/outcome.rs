//! What the print dialog reported — per platform, and only what it exposes.
//!
//! Purpose: `print_document` used to resolve `Ok(())` whatever the user did
//! with the dialog, so the frontend could not tell a cancelled print from a
//! finished one (`print-document`, F5). This is the one type both sides read,
//! and each platform's mapping from its native signal onto it (WI-FL6.3).
//!
//! What each platform exposes, verified against the vendored bindings:
//!   - **macOS** — `NSPrintOperation runOperationModalForWindow:delegate:
//!     didRunSelector:contextInfo:` sends `printOperationDidRun:success:
//!     contextInfo:` when the sheet ends; `success` is NO when the user
//!     cancels. It is also NO when the job itself fails, which AppKit reports
//!     to the user in its own alert — the two are not separable here.
//!   - **Linux** — `webkit_print_operation_run_dialog` returns
//!     `WEBKIT_PRINT_OPERATION_RESPONSE_CANCEL` or `_PRINT`; a confirmed job
//!     then emits `finished` (or `failed`), which is where completion is known.
//!   - **Windows** — `ICoreWebView2_16::ShowPrintUI` returns as soon as the
//!     UI is shown, with no completion handler and no result. Only `Print`
//!     and `PrintToPdf`, which show no dialog, report a status. So Windows can
//!     only ever say `Unknown`.
//!
//! `Unknown` is a first-class value, not an error: on Windows the dialog was
//! shown and the user is doing something with it, and nothing the app can
//! observe says what.
//!
//! macOS's one flag is ambiguous, and the wire says so (#215, #228): a
//! `cancelled` from the sheet carries `mayHaveFailed: true`, because
//! `success == NO` is what AppKit sends for a dismissed panel AND for a job
//! that failed after the user pressed Print — `NSPrintOperation` exposes no
//! error, `runOperation` returns the same one bit, and the objc2-app-kit
//! binding carries nothing more. The field is ADDITIVE, which is what this
//! struct was shaped for: a consumer that reads only `status` still sees "no
//! print happened", never a false `completed`; one that reads the flag can
//! keep quiet where "cancelled" would contradict the alert AppKit already
//! showed.
//!
//! @coordinates-with macos_print.rs, windows_print.rs, linux_print.rs — produce it
//! @coordinates-with commands.rs — returns it from `print_document`
//! @coordinates-with src/export/printOutcome.ts — reads it
//! @module pdf_export/renderer/outcome

/// What the user did with the print dialog, where the platform can say.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrintStatus {
    /// The operation ran to the end: a job was sent, or the panel's own
    /// "save as PDF" wrote its file.
    Completed,
    /// The dialog ended without a print. On Linux that is the user's Cancel,
    /// and certain. On macOS `printOperationDidRun:success:` reports NO for
    /// a dismissed panel AND for a job that failed, and exposes nothing that
    /// separates them (#215, #228); that outcome carries
    /// [`PrintOutcome::may_have_failed`] so the ambiguity is on the wire
    /// rather than hidden behind a word that promises user dismissal.
    Cancelled,
    /// The platform reports nothing after showing the dialog (Windows).
    Unknown,
}

/// The value `print_document` resolves with.
///
/// A struct rather than the bare enum so a later field (the printer chosen,
/// the page count) is an addition, not a wire-shape change.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOutcome {
    pub status: PrintStatus,
    /// `status` is `Cancelled` and the platform's signal ALSO covers a job
    /// that failed after confirmation — macOS's `success == NO` (#215, #228).
    /// Absent on the wire wherever the platform can tell the two apart.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub may_have_failed: bool,
}

impl PrintOutcome {
    pub const fn completed() -> Self {
        Self {
            status: PrintStatus::Completed,
            may_have_failed: false,
        }
    }

    /// The dialog was dismissed, and the platform can vouch for that.
    pub const fn cancelled() -> Self {
        Self {
            status: PrintStatus::Cancelled,
            may_have_failed: false,
        }
    }

    /// No print happened, and the platform cannot say whether the user
    /// dismissed the dialog or the job failed after they confirmed it.
    pub const fn cancelled_or_failed() -> Self {
        Self {
            status: PrintStatus::Cancelled,
            may_have_failed: true,
        }
    }

    pub const fn unknown() -> Self {
        Self {
            status: PrintStatus::Unknown,
            may_have_failed: false,
        }
    }

    /// macOS: the `success` flag of `printOperationDidRun:success:contextInfo:`.
    ///
    /// NO covers both cancel and a failed job, and AppKit exposes nothing
    /// that separates them — so NO is reported as exactly that: no print,
    /// possibly a failure, never a false "printed" and never a certain
    /// "dismissed".
    #[cfg(target_os = "macos")]
    pub const fn from_did_run_success(success: bool) -> Self {
        if success {
            Self::completed()
        } else {
            Self::cancelled_or_failed()
        }
    }

    /// Linux: what `run_dialog` returned.
    ///
    /// `None` means the job is now RUNNING and the outcome arrives later, on
    /// the operation's `finished`/`failed` signal (#1343). `Some` means the
    /// dialog is over and nothing was started — settle now.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn from_dialog_response(response: webkit2gtk::PrintOperationResponse) -> Option<Self> {
        use webkit2gtk::PrintOperationResponse;
        match response {
            PrintOperationResponse::Print => None,
            PrintOperationResponse::Cancel => Some(Self::cancelled()),
            // GTK defines exactly two responses; an unmapped value would be a
            // binding drift, not a user action, and must not read as either.
            _ => Some(Self::unknown()),
        }
    }

    /// Windows: `ShowPrintUI` has returned. That is all it ever says.
    #[cfg(target_os = "windows")]
    pub const fn from_show_print_ui() -> Self {
        Self::unknown()
    }
}

#[cfg(test)]
#[path = "outcome.test.rs"]
mod tests;
