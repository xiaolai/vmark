//! Windows native print dialog — `ICoreWebView2_16::ShowPrintUI`.
//!
//! Purpose: split from `windows.rs` so each stays under the size limit, and
//! because a dialog is a different concern from writing a file — this path
//! renders into a VISIBLE window and hands control to the user, where export
//! renders off-screen and completes on its own.
//!
//! Settles once the dialog has been SHOWN. WebView2 reports no completion for
//! the print UI, exactly as `NSPrintOperation` reports none for its panel, so
//! no platform here can say what the user then chose.
//!
//! @coordinates-with windows.rs — shares the window, URL and error helpers
//! @module pdf_export/renderer/windows_print

use std::sync::Arc;

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
};
use webview2_com::NavigationCompletedEventHandler;
use windows_core::{Interface, BOOL, HSTRING, PCWSTR};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

use super::windows::{close, com_error, path_to_file_url, window_error, LABEL_PREFIX};
use super::RenderSink;

/// Show the system print dialog for the rendered document.
///
/// Like macOS, this settles once the dialog has been SHOWN. Neither platform
/// can tell what the user then does with it — WebView2 reports no completion
/// for the print UI, exactly as `NSPrintOperation` reports none for its panel.
pub(super) fn print_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    _read_access_dir: &str,
    sink: Arc<RenderSink>,
) {
    if let Err(e) = start_print(app, html_path, sink.clone()) {
        sink.settle(Err(e));
    }
}

fn start_print(
    app: &AppHandle,
    html_path: &str,
    sink: Arc<RenderSink>,
) -> Result<(), CommandError> {
    let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let file_url = path_to_file_url(html_path)?;
    let blank = "about:blank".parse().expect("about:blank parses");
    // Visible: a print dialog with no window behind it is disorienting, and
    // the user needs somewhere to see what they are printing.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(true)
        .title("VMark Print")
        .build()
        .map_err(|e| window_error(&e.to_string()))?;

    let app_cb = app.clone();
    let label_cb = label.clone();
    window
        .with_webview(move |pw| {
            let core = match unsafe { pw.controller().CoreWebView2() } {
                Ok(c) => c,
                Err(e) => {
                    sink.settle(Err(com_error("core", &e)));
                    close(&app_cb, &label_cb);
                    return;
                }
            };
            let sink_nav = sink.clone();
            let core_nav = core.clone();
            let handler =
                NavigationCompletedEventHandler::create(Box::new(move |_sender, args| {
                    let ok = args
                        .as_ref()
                        .map(|a| {
                            let mut success = BOOL::default();
                            unsafe { a.IsSuccess(&mut success) }.is_ok() && success.as_bool()
                        })
                        .unwrap_or(false);
                    if !ok {
                        sink_nav.settle(Err(localized_error!(
                            ErrorCode::Io,
                            "errors.pdf.loadFailed"
                        )));
                        return Ok(());
                    }
                    let outcome = core_nav
                        .cast::<ICoreWebView2_16>()
                        .and_then(|v| unsafe {
                            v.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER)
                        })
                        .map_err(|e| com_error("ShowPrintUI", &e));
                    sink_nav.settle(outcome);
                    Ok(())
                }));
            let mut token = Default::default();
            if let Err(e) = unsafe { core.add_NavigationCompleted(&handler, &mut token) } {
                sink.settle(Err(com_error("navigation handler", &e)));
                close(&app_cb, &label_cb);
                return;
            }
            let url = HSTRING::from(file_url.as_str());
            if let Err(e) = unsafe { core.Navigate(PCWSTR(url.as_ptr())) } {
                sink.settle(Err(com_error("navigate", &e)));
                close(&app_cb, &label_cb);
            }
        })
        .map_err(|e| window_error(&e.to_string()))?;
    Ok(())
}
