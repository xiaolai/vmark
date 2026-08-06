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

use tauri::AppHandle;
const MSG: &str = "UNSUPPORTED_PLATFORM: embedded browser surface is macOS-only in this build";
pub fn create(_a: &AppHandle, _t: String, _w: String, _u: String) -> Result<(), String> {
    Err(MSG.into())
}
pub fn create_with_mode(
    _a: &AppHandle,
    _t: String,
    _w: String,
    _u: String,
    _mode: crate::browser::registry::AutomationMode,
    _profile: Option<String>,
) -> Result<(), String> {
    Err(MSG.into())
}
pub fn forget_profile(_a: &AppHandle, _p: String) -> Result<(), String> {
    Err(MSG.into())
}
pub fn clear_ai_sandbox_store(_a: &AppHandle) -> Result<(), String> {
    Err(MSG.into())
}
pub fn navigate(_a: &AppHandle, _t: String, _u: String) -> Result<(), String> {
    Err(MSG.into())
}
pub fn go_history(_a: &AppHandle, _t: String, _forward: bool) -> Result<(), String> {
    Err(MSG.into())
}
pub fn stop(_a: &AppHandle, _t: String) -> Result<(), String> {
    Err(MSG.into())
}
pub fn dialog_respond(_a: &AppHandle, _id: u64, _accepted: bool) -> Result<(), String> {
    Err(MSG.into())
}
pub fn set_bounds(
    _a: &AppHandle,
    _t: String,
    _x: f64,
    _y: f64,
    _w: f64,
    _h: f64,
) -> Result<(), String> {
    Err(MSG.into())
}
pub fn destroy(_a: &AppHandle, _t: String) -> Result<(), String> {
    Err(MSG.into())
}
pub fn assert_no_bridge(_a: &AppHandle, _t: String) -> Result<String, String> {
    Err(MSG.into())
}
pub fn eval(
    _a: &AppHandle,
    _t: String,
    _s: String,
    _expected_generation: u64,
) -> Result<String, String> {
    Err(MSG.into())
}
pub fn screenshot(_a: &AppHandle, _t: String) -> Result<String, String> {
    Err(MSG.into())
}
pub fn capture_cookies(
    _a: &AppHandle,
    _t: String,
    _host: String,
) -> Result<Vec<crate::browser::session_state::StoredCookie>, String> {
    Err(MSG.into())
}
pub fn apply_cookies(
    _a: &AppHandle,
    _t: String,
    _host: String,
    _origin: String,
    _c: Vec<crate::browser::session_state::StoredCookie>,
) -> Result<(), String> {
    Err(MSG.into())
}
pub fn set_hidden(_a: &AppHandle, _t: String, _h: bool) -> Result<(), String> {
    Err(MSG.into())
}
/// No native surface on this platform, so no live views — an empty list is the
/// truthful answer, not an error.
#[cfg(debug_assertions)]
pub fn debug_native_tab_ids(_a: &AppHandle) -> Result<Vec<String>, String> {
    Ok(Vec::new())
}
#[cfg(debug_assertions)]
pub fn debug_attached_webviews(_a: &AppHandle, _w: String) -> Result<usize, String> {
    Ok(0)
}
#[cfg(debug_assertions)]
pub fn debug_hit_test(
    _a: &AppHandle,
    _t: String,
    _w: String,
    _x: f64,
    _y: f64,
) -> Result<(bool, String), String> {
    Err(MSG.into())
}
