//! View/URL helpers for the macOS surface — resolving the parent NSView a browsed
//! webview attaches to, building an NSURL, and classifying a `callAsyncJavaScript`
//! completion. Split from surface_macos.rs to keep it under the size limit; `super::`
//! refers to that module (which is `imp` under surface.rs). Pure objc2/Tauri glue — no
//! thread-local state.

use crate::browser::eval_outcome::{script_error_message, EvalFailure, MAX_EVAL_RESULT_UTF16};
use crate::browser::native_failure::NativeSurfaceError;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{ClassType, MainThreadMarker};
use objc2_app_kit::{NSView, NSWindow};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_foundation::{NSDictionary, NSError, NSErrorUserInfoKey, NSNumber, NSString, NSURL};
use objc2_web_kit::WKWebView;
use tauri::AppHandle;

/// The AppKit frame for a rect the frontend measured in DOM space.
///
/// DOM rects are top-left/y-down; an unflipped `NSView` is bottom-left/y-up. The
/// conversion is resolved against the webview's ACTUAL parent (its height and its
/// `isFlipped`) rather than assumed — see `browser/geometry.rs`, which owns the
/// arithmetic and the tests, including the symmetric-layout trap that hid this bug.
pub(super) fn frame_for_dom_rect(
    webview: &WKWebView,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> CGRect {
    // SAFETY: read-only view-hierarchy access on the main thread (callers are
    // inside on_main); the webview is retained by the caller's map.
    let origin_y = match unsafe { webview.superview() } {
        Some(parent) => crate::browser::geometry::appkit_origin_y(
            parent.bounds().size.height,
            parent.isFlipped(),
            y,
            height,
        ),
        // Detached mid-teardown: nothing will be seen either way — keep the DOM
        // value rather than invent a frame.
        None => y,
    };
    CGRect {
        origin: CGPoint { x, y: origin_y },
        size: CGSize { width, height },
    }
}

/// The `userInfo` keys WebKit sets on a `WKErrorJavaScriptExceptionOccurred`. Public
/// dictionary keys (the `_WK…ErrorKey` constants naming them are SPI, the strings are
/// not), read by string so no private symbol is linked.
const EXCEPTION_MESSAGE_KEY: &str = "WKJavaScriptExceptionMessage";
const EXCEPTION_LINE_KEY: &str = "WKJavaScriptExceptionLineNumber";
const EXCEPTION_COLUMN_KEY: &str = "WKJavaScriptExceptionColumnNumber";

fn user_info_string(
    info: &NSDictionary<NSErrorUserInfoKey, AnyObject>,
    key: &str,
) -> Option<String> {
    let value = info.objectForKey(&NSString::from_str(key))?;
    let is_string: bool = unsafe { objc2::msg_send![&*value, isKindOfClass: NSString::class()] };
    if !is_string {
        return None;
    }
    // SAFETY: class-checked above; the dictionary retains the value for the call.
    let ns: &NSString = unsafe { &*Retained::as_ptr(&value).cast::<NSString>() };
    Some(ns.to_string())
}

fn user_info_int(info: &NSDictionary<NSErrorUserInfoKey, AnyObject>, key: &str) -> Option<i64> {
    let value = info.objectForKey(&NSString::from_str(key))?;
    let is_number: bool = unsafe { objc2::msg_send![&*value, isKindOfClass: NSNumber::class()] };
    if !is_number {
        return None;
    }
    // SAFETY: class-checked above.
    let number: &NSNumber = unsafe { &*Retained::as_ptr(&value).cast::<NSNumber>() };
    Some(number.integerValue() as i64)
}

/// The message for a WebKit evaluation error: the thrown exception's own text and
/// position when WebKit recorded them, else the localized description.
fn script_error(error: &NSError) -> String {
    let info = error.userInfo();
    script_error_message(
        &error.localizedDescription().to_string(),
        user_info_string(&info, EXCEPTION_MESSAGE_KEY).as_deref(),
        user_info_int(&info, EXCEPTION_LINE_KEY),
        user_info_int(&info, EXCEPTION_COLUMN_KEY),
    )
}

/// Classify a `callAsyncJavaScript` completion WITHOUT assuming the value's class.
///
/// The result maps a JS value to an ObjC type: a string → `NSString`, but a number
/// → `NSNumber`, an array → `NSArray`, a bool → `NSNumber`, etc. The old code cast
/// every result straight to `NSString` and called an `NSString` method on it; a
/// script that returned anything but a string therefore hit
/// `-[NSNumber ...]: unrecognized selector` — an uncaught `NSException` that
/// **terminates the whole app** (found in the live E2E run). So the class is
/// checked first, and every non-string outcome is a TYPED failure (audit 20260903
/// E-04) rather than a string the caller mistakes for a result:
///   - an `NSError` → `ScriptError`, carrying the exception text and position;
///   - `nil` with no error → `NoValue`;
///   - a non-string object → `ScriptError` naming the rule (VMark's scripts
///     return JSON strings); its class is logged, never its `-description`, which
///     is page-derived;
///   - a string past [`MAX_EVAL_RESULT_UTF16`] → `TooLarge`, measured on the
///     `NSString` BEFORE it is copied into Rust, so the bound caps the allocation.
pub(super) fn js_result_to_outcome(
    value: *mut AnyObject,
    error: *mut NSError,
) -> Result<String, EvalFailure> {
    if !error.is_null() {
        // SAFETY: WebKit hands the completion handler a valid (autoreleased) error.
        let error: &NSError = unsafe { &*error };
        return Err(EvalFailure::ScriptError(script_error(error)));
    }
    if value.is_null() {
        return Err(EvalFailure::NoValue);
    }
    // SAFETY: WebKit hands the completion handler a valid (autoreleased) object.
    let obj: &AnyObject = unsafe { &*value };
    let is_string: bool = unsafe { objc2::msg_send![obj, isKindOfClass: NSString::class()] };
    if !is_string {
        log::debug!(
            "[browser] eval returned a non-string {}",
            obj.class().name().to_string_lossy()
        );
        return Err(EvalFailure::non_string());
    }
    let ns: &NSString = unsafe { &*value.cast::<NSString>() };
    if ns.length() > MAX_EVAL_RESULT_UTF16 {
        return Err(EvalFailure::TooLarge);
    }
    Ok(ns.to_string())
}

/// The content view of the SPECIFIC Tauri window `window_label` names — the parent
/// for our native subview.
///
/// Resolving the exact window (via Tauri's own handle) rather than `keyWindow()`
/// is what makes a browser tab land in the window it belongs to: with two windows
/// open, the key one is whichever the user last clicked, not necessarily the one
/// that owns the tab.
///
/// **There is no fallback, and that is deliberate.** This used to attach to the key (or
/// first) window when the label could not be resolved, reasoning that a visible attach
/// beat a silent failure. It does not. The label fails to resolve when the window has been
/// torn down — so the tab that asked for this browser is gone, and there is nothing left to
/// show it in. Attaching anyway drops a live web page into a window that never asked for
/// one, on top of a document the user is editing, taking the clicks meant for it. A create
/// that cannot find its window fails, the command layer rolls the registry entry back, and
/// the surface shows the error (WI-S0.9). (Audit, High.)
pub(super) fn content_view(
    app: &AppHandle,
    window_label: &str,
    _mtm: MainThreadMarker,
) -> Result<Retained<NSView>, NativeSurfaceError> {
    use tauri::Manager;
    let win = app.get_webview_window(window_label).ok_or_else(|| {
        NativeSurfaceError::WindowGone(format!(
            "window '{window_label}' is gone; nothing to attach a browser to"
        ))
    })?;
    let ptr = win.ns_window().map_err(|e| {
        NativeSurfaceError::WindowGone(format!("window '{window_label}' has no NSWindow: {e}"))
    })?;
    // SAFETY: Tauri owns the NSWindow; we borrow it on the main thread (we are inside
    // on_main) only to read its content view. The pointer is non-null when ns_window()
    // succeeds.
    let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
    ns_window.contentView().ok_or_else(|| {
        NativeSurfaceError::WindowGone(format!("window '{window_label}' has no contentView"))
    })
}

pub(super) fn ns_url(url: &str) -> Result<Retained<NSURL>, NativeSurfaceError> {
    NSURL::URLWithString(&NSString::from_str(url))
        .ok_or_else(|| NativeSurfaceError::InvalidUrl(format!("invalid URL: {url}")))
}
