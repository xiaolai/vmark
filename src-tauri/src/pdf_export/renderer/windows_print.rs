//! Windows native print dialog — `ICoreWebView2_16::ShowPrintUI`.
//!
//! Purpose: split from `windows.rs` so each stays under the size limit, and
//! because a dialog is a different concern from writing a file — this path
//! renders into a VISIBLE window and hands control to the user, where export
//! renders off-screen and completes on its own.
//!
//! Settles once the dialog has been SHOWN, with the outcome `unknown`
//! (WI-FL6.3). `ICoreWebView2_16::ShowPrintUI` takes only the dialog kind and
//! returns as soon as the UI is up: no completion handler, no status. The
//! interface's `Print` and `PrintToPdf` do report a `COREWEBVIEW2_PRINT_STATUS`,
//! but neither shows a dialog, so they cannot replace this. Windows is the one
//! platform that cannot say what the user then chose; macOS and Linux can.
//!
//! The window, the one-shot navigation and every failure's cleanup are
//! `windows_nav.rs`'s, shared with export (#236, #237, #238, #239): the
//! completion is matched by the navigation id its start reported, the sink
//! is claimed before the UI is shown (#227), and a caller whose bounded wait
//! ends before that claim closes the window (#227). This file keeps what is
//! print's own: showing the print UI once the document loaded.
//!
//! @coordinates-with windows_nav.rs — builds, navigates and hands over the loaded webview
//! @coordinates-with windows.rs — shares the error helpers
//! @coordinates-with outcome.rs — `from_show_print_ui`
//! @module pdf_export/renderer/windows_print

use std::sync::Arc;

use tauri::AppHandle;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
};
use windows_core::Interface;

use crate::command_error::CommandError;

use super::outcome::PrintOutcome;
use super::windows::{close, com_error};
use super::windows_nav::navigate_once;
use super::RenderSink;

/// Show the system print dialog for the rendered document.
///
/// Settles once the dialog has been SHOWN, and with `unknown`: WebView2
/// reports nothing about the print UI after that point, so nothing more
/// definite would be true.
pub(super) fn print_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    _read_access_dir: &str,
    sink: Arc<RenderSink<PrintOutcome>>,
) {
    if let Err(e) = start_print(app, html_path, sink.clone()) {
        sink.settle(Err(e));
    }
}

fn start_print(
    app: &AppHandle,
    html_path: &str,
    sink: Arc<RenderSink<PrintOutcome>>,
) -> Result<(), CommandError> {
    // Translated (audit 20260907 #464). This is not a hidden helper: the window
    // is VISIBLE behind the print dialog and its title is what the user reads
    // in the task bar and the Alt-Tab switcher, so an English literal here is
    // the one untranslated string on an otherwise localized surface.
    let title = rust_i18n::t!("window.print.title");
    // Visible: a print dialog with no window behind it is disorienting, and
    // the user needs somewhere to see what they are printing.
    navigate_once(
        app,
        html_path,
        true,
        &title,
        sink,
        Box::new(|core, app, label, sink| {
            let outcome = core
                .cast::<ICoreWebView2_16>()
                .and_then(|v| unsafe { v.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER) })
                .map_err(|e| com_error("ShowPrintUI", &e))
                .map(|()| PrintOutcome::from_show_print_ui());
            // On FAILURE close; on success deliberately do not. The window
            // is visible and the user is now looking at a print dialog over
            // it — closing it from under them would take the dialog with
            // it. They dismiss it themselves, which is ordinary window
            // behaviour.
            if outcome.is_err() {
                close(app, label);
            }
            // Shown and settled in one breath: there is no later signal to
            // wait for on this platform.
            sink.shown();
            sink.settle(outcome);
        }),
    )
}
