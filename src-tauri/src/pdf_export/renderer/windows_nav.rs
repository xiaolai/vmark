//! One navigation of a throwaway WebView2 window to the render document,
//! shared by export and print (#236).
//!
//! Purpose: `windows.rs` and `windows_print.rs` each built the window, took
//! the `CoreWebView2`, registered a `NavigationCompleted` handler, navigated
//! and cleaned up on every failure — twice, so a lifecycle fix in one was a
//! lifecycle bug in the other. This is the one copy; each caller supplies
//! only what happens once the document has loaded.
//!
//! What it guarantees (#233, #234, #237, #238, #239):
//!   - both handlers are registered BEFORE the document navigation starts,
//!     and the completion acted on is the DOCUMENT's, once: `NavigationStarting`
//!     tells `navigation.rs` the id of the navigation whose URI names the
//!     document, and `NavigationCompleted` is matched on that id — so
//!     neither the initial `about:blank` page's late completion (even one
//!     delivered after the webview's `Source` has advanced to the document)
//!     nor any other navigation can start a print, and no second delivery
//!     can start a second one;
//!   - the sink is claimed inside that decision (#227): a document that
//!     loaded for a caller whose bounded wait ended is torn down, never
//!     printed or shown;
//!   - every failure after the window exists goes through ONE path,
//!     [`RenderWindow::fail`] — settle, then close — so no branch can forget
//!     the close that used to leave a hidden window and its Edge process
//!     behind (a `with_webview` that fails included);
//!   - the caller's timeout can close the window too (#224, #227): the
//!     window's close is armed on the sink as soon as the window exists,
//!     and `wait.rs` runs it when its bound elapses.
//!
//! @coordinates-with windows.rs — export: prints to PDF once loaded
//! @coordinates-with windows_print.rs — print: shows the print UI once loaded
//! @coordinates-with navigation.rs — the pure one-shot decision
//! @coordinates-with teardown.rs — the close the timeout runs
//! @module pdf_export/renderer/windows_nav

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use tauri::webview::PlatformWebview;
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2NavigationCompletedEventArgs,
    ICoreWebView2NavigationCompletedEventHandler, ICoreWebView2NavigationStartingEventArgs,
    ICoreWebView2NavigationStartingEventHandler,
};
use webview2_com::{take_pwstr, NavigationCompletedEventHandler, NavigationStartingEventHandler};
use windows_core::{BOOL, HSTRING, PCWSTR, PWSTR};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

use super::navigation::{Completion, NavigationStep, OneShotNavigation, INITIAL_PAGE};
use super::windows::{close, com_error, fail_render, path_to_file_url, window_error, LABEL_PREFIX};
use super::RenderSink;

/// What a caller does once the document has loaded in `core`.
pub(super) type OnLoaded<T> =
    Box<dyn FnOnce(&ICoreWebView2, &AppHandle, &str, Arc<RenderSink<T>>) + Send + 'static>;

/// The gate both navigation handlers share. `Rc<RefCell>`, not a mutex:
/// WebView2 raises both events on the UI thread that owns the controller,
/// and each handler releases its borrow before it acts, so neither can
/// re-enter the other's.
type Gate = Rc<RefCell<OneShotNavigation>>;

/// The throwaway window, and the one way a failure after it ends.
#[derive(Clone)]
struct RenderWindow {
    app: AppHandle,
    label: String,
}

impl RenderWindow {
    /// A hidden-or-visible window on the initial page, labelled uniquely so
    /// two concurrent renders cannot collide on a label Tauri treats as a key.
    fn build(
        app: &AppHandle,
        visible: bool,
        title: &str,
    ) -> Result<(WebviewWindow, Self), CommandError> {
        let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple());
        let initial = INITIAL_PAGE.parse().expect("the initial page parses");
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(initial))
            .visible(visible)
            .title(title)
            .build()
            .map_err(|e| window_error(&e.to_string()))?;
        Ok((
            window,
            Self {
                app: app.clone(),
                label,
            },
        ))
    }

    /// Settle `sink` with `err`, then tear the window down. Every failure
    /// after the window exists ends here, so none can leak it.
    fn fail<T>(&self, sink: &RenderSink<T>, err: CommandError) {
        fail_render(&self.app, &self.label, sink, err);
    }

    fn close(&self) {
        close(&self.app, &self.label);
    }
}

/// Build a window on the initial page, navigate it to `html_path`, and run
/// `on_loaded` exactly once when the document's navigation completes. Every
/// failure settles `sink` and closes the window.
pub(super) fn navigate_once<T: Send + 'static>(
    app: &AppHandle,
    html_path: &str,
    visible: bool,
    title: &str,
    sink: Arc<RenderSink<T>>,
    on_loaded: OnLoaded<T>,
) -> Result<(), CommandError> {
    let file_url = path_to_file_url(html_path)?;
    let (window, render) = RenderWindow::build(app, visible, title)?;
    // From here the caller's timeout can close the window (#224, #227);
    // every settle path below closes it itself.
    let render_timeout = render.clone();
    sink.teardown.arm(move || render_timeout.close());
    let render_cb = render.clone();
    let attached = window.with_webview(move |pw| attach(pw, render_cb, file_url, sink, on_loaded));
    if let Err(e) = attached {
        // The window exists; returning without this leaked it and its Edge
        // process (#234, #239).
        render.close();
        return Err(window_error(&e.to_string()));
    }
    Ok(())
}

/// On the UI thread that owns the controller: take the core, register both
/// navigation handlers BEFORE navigating (#233), then navigate.
fn attach<T: Send + 'static>(
    pw: PlatformWebview,
    render: RenderWindow,
    file_url: String,
    sink: Arc<RenderSink<T>>,
    on_loaded: OnLoaded<T>,
) {
    // SAFETY: `with_webview` runs on the UI thread that owns the controller —
    // the apartment every call below requires.
    let core = match unsafe { pw.controller().CoreWebView2() } {
        Ok(core) => core,
        Err(e) => return render.fail(&sink, com_error("core", &e)),
    };
    let gate: Gate = Rc::new(RefCell::new(OneShotNavigation::for_document(&file_url)));
    // Starting before completed, both before the navigation: the document's
    // id is learned at its start and matched at its end.
    let starting = starting_handler(gate.clone());
    let mut token = Default::default();
    if let Err(e) = unsafe { core.add_NavigationStarting(&starting, &mut token) } {
        return render.fail(&sink, com_error("navigation-starting handler", &e));
    }
    let handler = completion_handler(render.clone(), sink.clone(), gate, on_loaded);
    let mut token = Default::default();
    if let Err(e) = unsafe { core.add_NavigationCompleted(&handler, &mut token) } {
        return render.fail(&sink, com_error("navigation handler", &e));
    }
    let url = HSTRING::from(file_url.as_str());
    if let Err(e) = unsafe { core.Navigate(PCWSTR(url.as_ptr())) } {
        render.fail(&sink, com_error("navigate", &e));
    }
}

/// The `NavigationStarting` handler: tell the gate which id the document's
/// navigation carries. It only records; every decision is the completion's.
fn starting_handler(gate: Gate) -> ICoreWebView2NavigationStartingEventHandler {
    NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
        if let Some((uri, id)) = navigation_started(args.as_ref()) {
            gate.borrow_mut().starting(uri.as_deref(), id);
        }
        Ok(())
    }))
}

/// The `NavigationCompleted` handler: read the event, ask the gate, act.
///
/// `create` hands back the COM interface, not the wrapper it is called on;
/// that interface is what `add_NavigationCompleted` takes.
///
/// The webview comes from the event's own `sender`, never from a captured
/// `ICoreWebView2` (#461). Capturing one put a strong COM reference to the
/// webview inside a handler registered ON that webview — a cycle that kept
/// the webview, this closure and the sink alive after the window closed,
/// since the tokens are not unregistered. `sender` is the same object,
/// borrowed for the length of the call.
fn completion_handler<T: Send + 'static>(
    render: RenderWindow,
    sink: Arc<RenderSink<T>>,
    gate: Gate,
    on_loaded: OnLoaded<T>,
) -> ICoreWebView2NavigationCompletedEventHandler {
    let mut on_loaded = Some(on_loaded);
    NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
        let source = sender.as_ref().and_then(current_source);
        let completion = Completion {
            navigation_id: args.as_ref().and_then(navigation_id_of),
            source: source.as_deref(),
            succeeded: navigation_succeeded(args.as_ref()),
        };
        // The claim is part of the decision, atomically with it (#227). The
        // borrow ends here, before the step acts.
        let step = gate.borrow_mut().classify(completion, || sink.claim());
        match step {
            NavigationStep::Ignore => {}
            NavigationStep::Failed => render.fail(
                &sink,
                localized_error!(ErrorCode::Io, "errors.pdf.loadFailed"),
            ),
            NavigationStep::Abandoned => render.fail(
                &sink,
                CommandError::cancelled("the caller stopped waiting before the document loaded"),
            ),
            NavigationStep::Loaded => {
                if let Some(act) = on_loaded.take() {
                    match sender.as_ref() {
                        Some(core) => act(core, &render.app, &render.label, sink.clone()),
                        // The gate consumed its one shot on this event, so no
                        // later completion can start the print: fail rather
                        // than leave the caller waiting out its bound.
                        None => render.fail(
                            &sink,
                            localized_error!(
                                ErrorCode::Internal,
                                "errors.pdf.comFailed",
                                stage = "navigation sender",
                                detail = "the completion event carried no webview"
                            ),
                        ),
                    }
                }
            }
        }
        Ok(())
    }))
}

/// A starting navigation's URI and id — `None` when the id cannot be read,
/// since nothing can be matched without it. A URI that cannot be read is
/// `None` inside: the gate then records nothing for it.
fn navigation_started(
    args: Option<&ICoreWebView2NavigationStartingEventArgs>,
) -> Option<(Option<String>, u64)> {
    let args = args?;
    let mut id = 0u64;
    // SAFETY: a live event-args object handed to us by the callback.
    unsafe { args.NavigationId(&mut id) }.ok()?;
    let mut uri = PWSTR::null();
    // SAFETY: `Uri` writes a CoTaskMem string the caller owns; `take_pwstr`
    // copies and frees it.
    let uri = unsafe { args.Uri(&mut uri) }.ok().map(|()| take_pwstr(uri));
    Some((uri, id))
}

/// The completed navigation's id, if it can be read.
fn navigation_id_of(args: &ICoreWebView2NavigationCompletedEventArgs) -> Option<u64> {
    let mut id = 0u64;
    // SAFETY: a live event-args object handed to us by the callback.
    unsafe { args.NavigationId(&mut id) }.ok().map(|()| id)
}

/// A FAILED navigation fires `NavigationCompleted` too. Without the flag a
/// missing file would print an empty document and report success — the
/// shape of failure that is hardest to see.
fn navigation_succeeded(args: Option<&ICoreWebView2NavigationCompletedEventArgs>) -> bool {
    args.map(|a| {
        let mut success = BOOL::default();
        // SAFETY: a live event-args object handed to us by the callback.
        unsafe { a.IsSuccess(&mut success) }.is_ok() && success.as_bool()
    })
    .unwrap_or(false)
}

/// The webview's current document URL, if it can be read — the gate's
/// fallback when an id cannot be.
fn current_source(core: &ICoreWebView2) -> Option<String> {
    let mut uri = PWSTR::null();
    // SAFETY: `Source` writes a CoTaskMem string the caller owns;
    // `take_pwstr` copies and frees it.
    unsafe { core.Source(&mut uri) }.ok()?;
    Some(take_pwstr(uri))
}
