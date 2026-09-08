//! One navigation of a throwaway WebKitGTK window to the render document,
//! shared by export and print (#205, #206).
//!
//! Purpose: `linux.rs` and `linux_print.rs` each built the window, wired
//! `load-failed` and `load-changed`, tracked a failed load across the two
//! handlers and cleaned up — twice, so a lifecycle fix in one was a lifecycle
//! bug in the other (the `with_webview` failure that leaked the window had
//! reached only the Windows twin). This is the one copy, the shape
//! `windows_nav.rs` already has; each caller supplies only what happens once
//! the document has loaded.
//!
//! What it guarantees:
//!   - `on_loaded` runs exactly once, on the DOCUMENT's `Finished`, and never
//!     after a failed load: a failed load still reaches `Finished` and
//!     `close()` only QUEUES the teardown, so without the flag the callback
//!     ran over WebKit's error page in a window already being torn down.
//!     `Rc<Cell>`, not `Arc`: GTK signal handlers all run on the main thread.
//!     If a SECOND navigation is ever added, reset both flags on
//!     `LoadEvent::Started`;
//!   - the BOOTSTRAP navigation settles nothing (#410). The window is built
//!     on `about:blank`, and these handlers are connected after that load
//!     began: `load_uri` then cancels it, which WebKitGTK reports as
//!     `load-failed` on `about:blank` — a failure the old handler settled as
//!     the document's. Its URI is checked, and `on_loaded` waits for a
//!     `Finished` whose `Started` this handler actually saw;
//!   - every failure after the window exists settles the sink and closes the
//!     window — a `with_webview` that fails included;
//!   - the caller's timeout can close the window too (#224, #227): its close
//!     is armed on the sink as soon as it exists, and `wait.rs` runs it when
//!     the bound elapses — WebKitGTK cannot cancel a print or a load, and
//!     destroying the webview is the one lever.
//!
//! The caller claims the sink itself, immediately before its irreversible
//! step (#227): export before `print()`, the dialog before `run_dialog()`.
//!
//! @coordinates-with linux.rs — export: prints to a file once loaded
//! @coordinates-with linux_print.rs — print: runs the dialog once loaded
//! @coordinates-with teardown.rs — the close the timeout runs
//! @module pdf_export/renderer/linux_nav

use std::sync::Arc;

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use webkit2gtk::WebViewExt;

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

use super::linux::{close, path_to_file_url, window_error, LABEL_PREFIX};
use super::navigation::INITIAL_PAGE;
use super::RenderSink;

/// What a caller does once the document has loaded in the webview.
pub(super) type OnLoaded<T> =
    Box<dyn FnOnce(&webkit2gtk::WebView, &AppHandle, &str, Arc<RenderSink<T>>) + Send + 'static>;

/// Build a hidden window, navigate it to `html_path`, and run `on_loaded`
/// exactly once when the document has finished loading. Every failure
/// settles `sink` and closes the window.
pub(super) fn navigate_once<T: Send + 'static>(
    app: &AppHandle,
    html_path: &str,
    title: &str,
    sink: Arc<RenderSink<T>>,
    on_loaded: OnLoaded<T>,
) -> Result<(), CommandError> {
    let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let file_url = path_to_file_url(html_path)?;
    let blank = "about:blank".parse().expect("about:blank parses");
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(false)
        .title(title)
        .build()
        .map_err(|e| window_error(&e.to_string()))?;
    // From here the caller's timeout can close the window (#224, #227);
    // every settle path below closes it itself.
    let app_timeout = app.clone();
    let label_timeout = label.clone();
    sink.teardown
        .arm(move || close(&app_timeout, &label_timeout));

    let app_cb = app.clone();
    let label_cb = label.clone();
    let attached = window.with_webview(move |pw| {
        let view = pw.inner();
        let load_failed = std::rc::Rc::new(std::cell::Cell::new(false));

        let sink_fail = sink.clone();
        let app_fail = app_cb.clone();
        let label_fail = label_cb.clone();
        let failed_flag = load_failed.clone();
        view.connect_load_failed(move |_, load_event, failing_uri, error| {
            // The window opens on the initial page, and `load_uri` below
            // CANCELS that load if it is still running — WebKitGTK reports
            // the cancellation as `load-failed` on `about:blank` (#410).
            // Settling it failed the export before the document had even
            // started loading. Only the document's own failure is ours.
            if failing_uri == INITIAL_PAGE {
                return false; // not handled — nothing to suppress on a page we never wanted
            }
            failed_flag.set(true);
            // The callback's other three arguments used to be discarded (audit
            // 20260907 #411), so a missing staging file, a permission refusal
            // and a decode failure all reached the user as one untraceable
            // "document failed to load" with nothing in the log either. The
            // GLib error carries the domain and code WebKitGTK classified it
            // under, and the load stage says how far it got.
            //
            // The failing URI is deliberately NOT attached: it is always
            // VMark's own staging file, whose path the caller already holds, so
            // it would add a filesystem path to a serialized error for no
            // diagnostic gain.
            let detail = serde_json::json!({
                "stage": format!("{load_event:?}"),
                "cause": error.to_string(),
            });
            log::warn!("[PDF] WebKitGTK load failed at {load_event:?}: {error}");
            sink_fail.settle(Err(localized_error!(
                ErrorCode::Io,
                "errors.pdf.loadFailed"
            )
            .with_detail(detail)));
            close(&app_fail, &label_fail);
            true // handled — suppress WebKit's own error page
        });

        // Taken once: a second `Finished` finds nothing to run.
        let on_loaded = std::cell::Cell::new(Some(on_loaded));
        let app_load = app_cb.clone();
        let label_load = label_cb.clone();
        // The bootstrap navigation started BEFORE these handlers existed, so
        // its `Started` is one we never see — which is exactly what makes it
        // usable as the gate (#410): `on_loaded` runs only on a `Finished`
        // that belongs to a load this handler watched begin, never on the
        // initial page's. If a SECOND document navigation is ever added, this
        // flag resets on its `Started` along with `load_failed`.
        let started = std::cell::Cell::new(false);
        view.connect_load_changed(move |view, event| {
            match event {
                webkit2gtk::LoadEvent::Started => {
                    started.set(true);
                    return;
                }
                webkit2gtk::LoadEvent::Finished => {}
                _ => return,
            }
            if !started.get() || load_failed.get() {
                return;
            }
            if let Some(act) = on_loaded.take() {
                act(view, &app_load, &label_load, sink.clone());
            }
        });

        view.load_uri(&file_url);
    });
    if let Err(e) = attached {
        // The window exists; returning without this leaked it and its
        // WebKit process.
        close(app, &label);
        return Err(window_error(&e.to_string()));
    }
    Ok(())
}
