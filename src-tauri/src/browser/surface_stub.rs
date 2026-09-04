//! Non-macOS native surface: explicit "unsupported" stubs.
//!
//! Split from `surface.rs` so the cross-platform state container stays under the
//! file-size gate, and because this is one coherent concern: every entry point
//! here exists to REFUSE honestly rather than to no-op silently. A caller must be
//! able to tell "not implemented on this platform" from "done".
//!
//! Windows (WebView2) and Linux (webkit2gtk) backends land in WI-5.1 / WI-5.2.
//! `browser/surface.test.rs` pins these signatures against the macOS ones — a
//! drift there compiles fine on macOS and breaks these targets.

use crate::browser::eval_outcome::EvalError;
use crate::browser::native_failure::NativeSurfaceError;
use tauri::AppHandle;

/// The one unsupported-platform failure, typed as the SAME class
/// `surface_failure` classifies (`NativeSurfaceError::UnsupportedPlatform`), so
/// the stub can never drift from the classifier by spelling its own tag.
fn unsupported() -> NativeSurfaceError {
    NativeSurfaceError::UnsupportedPlatform(
        "embedded browser surface is macOS-only in this build".to_string(),
    )
}

/// Every stub entry point returns this — one definition, not fourteen.
fn refuse<T>() -> Result<T, NativeSurfaceError> {
    Err(unsupported())
}

pub fn create(
    _a: &AppHandle,
    _t: String,
    _w: String,
    _u: String,
) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn create_with_mode(
    _a: &AppHandle,
    _t: String,
    _w: String,
    _u: String,
    _mode: crate::browser::registry::AutomationMode,
    _profile: Option<String>,
    _allow_loopback: bool,
) -> Result<(), NativeSurfaceError> {
    Err(unsupported())
}
pub fn forget_profile(_a: &AppHandle, _p: String) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn clear_ai_sandbox_store(_a: &AppHandle) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn navigate(_a: &AppHandle, _t: String, _u: String) -> Result<(), NativeSurfaceError> {
    Err(unsupported())
}
pub fn go_history(_a: &AppHandle, _t: String, _forward: bool) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn stop(_a: &AppHandle, _t: String) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn dialog_respond(
    _a: &AppHandle,
    _id: u64,
    _accepted: bool,
    _window_label: String,
) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn set_bounds(
    _a: &AppHandle,
    _t: String,
    _x: f64,
    _y: f64,
    _w: f64,
    _h: f64,
) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn destroy(_a: &AppHandle, _t: String) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn assert_no_bridge(_a: &AppHandle, _t: String) -> Result<String, EvalError> {
    Err(EvalError::Surface(unsupported()))
}
pub fn eval(
    _a: &AppHandle,
    _t: String,
    _s: String,
    _expected_generation: u64,
) -> Result<String, EvalError> {
    Err(EvalError::Surface(unsupported()))
}
pub fn screenshot(_a: &AppHandle, _t: String) -> Result<String, NativeSurfaceError> {
    refuse()
}
pub fn capture_cookies(
    _a: &AppHandle,
    _t: String,
    _host: String,
) -> Result<Vec<crate::browser::session_state::StoredCookie>, NativeSurfaceError> {
    refuse()
}
pub fn apply_cookies(
    _a: &AppHandle,
    _t: String,
    _host: String,
    _origin: String,
    _c: Vec<crate::browser::session_state::StoredCookie>,
) -> Result<(), NativeSurfaceError> {
    refuse()
}
pub fn set_hidden(_a: &AppHandle, _t: String, _h: bool) -> Result<(), NativeSurfaceError> {
    refuse()
}
/// No native surface on this platform, so no live views — an empty list is the
/// truthful answer, not an error.
#[cfg(debug_assertions)]
pub fn debug_native_tab_ids(_a: &AppHandle) -> Result<Vec<String>, NativeSurfaceError> {
    Ok(Vec::new())
}
#[cfg(debug_assertions)]
pub fn debug_attached_webviews(_a: &AppHandle, _w: String) -> Result<usize, NativeSurfaceError> {
    Ok(0)
}
#[cfg(debug_assertions)]
pub fn debug_hit_test(
    _a: &AppHandle,
    _t: String,
    _w: String,
    _x: f64,
    _y: f64,
) -> Result<(bool, String), NativeSurfaceError> {
    refuse()
}
