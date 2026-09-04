//! Native webview creation for the browser surface (WI-1.2 / WI-P6.1, macOS).
//!
//! Split out of surface_macos.rs (which stays under the file-size limit). Included
//! via `#[path]` as a CHILD of that module, so `super::` reaches its private
//! helpers (`on_main`, `WEBVIEWS`/`DELEGATES`, the view/store/lifecycle submodules).
//!
//! Failures are typed `NativeSurfaceError` end to end (round 4, #31). The view and
//! store helpers (`content_view`, `ns_url`, `browser_store::configure`) fail typed.
//! here spells a `fail::` token.

use crate::browser::native_failure::NativeSurfaceError;
use crate::browser::registry::AutomationMode;
use objc2::MainThreadOnly;
use objc2_core_foundation::CGRect;
use objc2_foundation::{NSRunLoop, NSURLRequest};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
use tauri::AppHandle;

/// Create the native webview for `tab_id`, add it as a subview of the
/// `window_label` window's content view, and load `url` (human posture).
pub fn create(
    app: &AppHandle,
    tab_id: String,
    window_label: String,
    url: String,
) -> Result<(), NativeSurfaceError> {
    // A human tab gets no AI destination rules, so the loopback posture is moot.
    create_webview(
        app,
        tab_id,
        window_label,
        url,
        AutomationMode::Human,
        None,
        false,
    )
}

/// Create a browser webview with an explicit data-store posture. The store is
/// selected before WKWebView construction, the only safe WebKit seam. A named
/// `profile` (AiSandbox, per-use user-approved) selects an isolated store so a login
/// persists for later reuse (WI-P6.1). Authorization for the profile is enforced by
/// the caller (`browser_ai_create`) BEFORE this runs.
///
/// `allow_loopback` is the AI destination posture the caller validated the URL
/// against; an AI-owned webview gets a content rule list compiled for the same
/// posture (audit 20260903 P-01), so subframes and subresources are held to the
/// policy the main frame was.
///
/// Typed end to end (round 4, #31): `ai_transactions::create_native` takes this
/// error as is, so `create_webview`'s failure reaches the classifier unrendered.
pub fn create_with_mode(
    app: &AppHandle,
    tab_id: String,
    window_label: String,
    url: String,
    mode: AutomationMode,
    profile: Option<String>,
    allow_loopback: bool,
) -> Result<(), NativeSurfaceError> {
    create_webview(
        app,
        tab_id,
        window_label,
        url,
        mode,
        profile,
        allow_loopback,
    )
}

/// The typed creation both entry points run.
fn create_webview(
    app: &AppHandle,
    tab_id: String,
    window_label: String,
    url: String,
    mode: AutomationMode,
    profile: Option<String>,
    allow_loopback: bool,
) -> Result<(), NativeSurfaceError> {
    let app_handle = app.clone();
    super::on_main(app, move |mtm| {
        // Validate all fallible inputs before registering native objects.
        let parent = super::content_view(&app_handle, &window_label, mtm)?;
        let url_obj = super::ns_url(&url)?;
        let req = NSURLRequest::requestWithURL(&url_obj);

        // Start at zero size; the frontend supplies the measured browser rect immediately.
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        // Fails closed if the named-store cap is exceeded (never shares the sandbox
        // store) — WI-P6.1 H2. Checked before any native object is registered.
        super::browser_store::configure(&config, mtm, mode, profile.as_deref())?;
        // The AI destination policy for every load the nav delegate cannot see —
        // subframes and subresources (audit 20260903 P-01). Fails closed: an AI
        // webview is never created without its rules.
        super::content_rules::configure(&config, mtm, mode, allow_loopback)?;
        // Page-world console-capture shim (WI-P7.1) — AI-owned tabs only; no message handler.
        super::console_shim::configure(&config, mtm, mode);
        // Dormant page-world recorder-capture shim (WI-NB7.1) — AI-owned tabs only; armed
        // at runtime by the isolated-world driver, no message handler.
        super::recorder_shim::configure(&config, mtm, mode);
        // Native takeover signal (WI-NB5.2): installed once, at the first browser
        // surface creation — before that no browser view exists to click into.
        super::user_input_monitor::ensure_installed(&app_handle, mtm);
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), CGRect::ZERO, &config)
        };
        // Evict before replacing the delegate so the old view is removed and its KVO
        // observer is detached before its retained delegate is released.
        super::evict_existing(&tab_id);
        // Attach the navigation delegate BEFORE the first load so its lifecycle
        // events (commit/finish/fail) fire for that load too. Held in DELEGATES
        // because WKWebView's navigationDelegate reference is weak.
        let delegate = super::NavDelegate::new(mtm, tab_id.clone(), app_handle);
        unsafe {
            webview.setNavigationDelegate(Some(delegate.as_protocol()));
            webview.setUIDelegate(Some(delegate.as_ui_protocol()));
        }
        delegate.observe_url(&webview);
        // BOTH maps, together, BEFORE anything can pump the run loop — the pairing
        // invariant that makes teardown sound. See surface_lifecycle_macos.rs.
        super::DELEGATES.with(|m| m.borrow_mut().insert(tab_id.clone(), delegate));
        super::WEBVIEWS.with(|m| m.borrow_mut().insert(tab_id.clone(), webview.clone()));
        let _ = unsafe { webview.loadRequest(&req) };
        parent.addSubview(&webview);
        // Drive the first navigation + paint with a bounded run-loop pump.
        let run_loop = NSRunLoop::mainRunLoop();
        super::drive_load(&webview, &run_loop);
        Ok(())
    })
}

/// Forget a named profile's on-disk data (WI-P6.5) — the native half of the
/// management UI's "Remove profile". Main-thread; no-op for an unknown profile.
pub fn forget_profile(app: &AppHandle, profile: String) -> Result<(), NativeSurfaceError> {
    super::on_main(app, move |mtm| {
        super::browser_store::forget_profile(&profile, mtm)
    })
}
