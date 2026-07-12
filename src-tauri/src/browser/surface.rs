//! Native browser surface — a VMark-owned WKWebView (WI-1.2, macOS).
//!
//! VMark constructs the `WKWebView` itself (fresh `WKWebViewConfiguration`,
//! ADR-B2) and adds it as an `NSView` subview of the Tauri window's content
//! view. Because Tauri did not create it, Tauri's IPC bridge is never injected —
//! the `assert_no_bridge` command exists to prove that as a live regression
//! check (R3 / SPIKE-1).
//!
//! Threading + ownership: all AppKit/WebKit calls run on the main thread via
//! `run_on_main_thread`. A `Retained<WKWebView>` is not `Send`, so the live
//! handles live in a **main-thread-local** map (`WEBVIEWS`), reached only from
//! inside main-thread closures. The `Send` lifecycle/identity registry
//! (`browser/registry.rs`) lives in Tauri-managed state; the two are kept
//! consistent by the command layer.
//!
//! The macOS objc2 recipe is the productionized form of the validated Phase-0
//! spike (git cd162e02:src-tauri/src/spike_embed.rs).

use crate::browser::recovery::CrashTracker;
use crate::browser::registry::BrowserRegistry;
use std::collections::HashMap;
use std::sync::Mutex;

/// Tauri-managed browser state: the platform-independent lifecycle/identity
/// registry (Send). Native handles are held per-platform, off this struct.
#[derive(Default)]
pub struct BrowserSurface {
    pub registry: Mutex<BrowserRegistry>,
    /// Per-tab consecutive-crash state (WI-1.8). The navigation delegate records
    /// crashes/clean-loads here to decide auto-reload vs. manual (recovery.rs).
    pub crash_trackers: Mutex<HashMap<String, CrashTracker>>,
}

/// The read-only JS that asserts no Tauri bridge leaked into the browsed page
/// (R3 / SPIKE-1). Returns a JSON object of booleans; all must be false.
pub const NO_BRIDGE_ASSERTION: &str = "return JSON.stringify({\
    hasTauriInternals: typeof window.__TAURI_INTERNALS__ !== 'undefined',\
    hasTauri: typeof window.__TAURI__ !== 'undefined',\
    hasIpc: typeof window.ipc !== 'undefined',\
    invokeReachable: (function(){try{return typeof window.__TAURI_INTERNALS__.invoke==='function';}catch(e){return false;}})()\
});";

#[cfg(target_os = "macos")]
#[path = "surface_macos.rs"]
mod imp;

// --- Cross-platform command-facing API -------------------------------------
// macOS delegates to `imp`; other platforms return an explicit "unsupported"
// (their native backends land in WI-5.1 / WI-5.2).

#[cfg(target_os = "macos")]
pub use imp::{assert_no_bridge, create, destroy, eval, go_history, navigate, set_bounds, set_hidden};

#[cfg(not(target_os = "macos"))]
mod stub {
    use tauri::AppHandle;
    const MSG: &str = "embedded browser surface is macOS-only in this build";
    pub fn create(_a: &AppHandle, _t: String, _u: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn navigate(_a: &AppHandle, _t: String, _u: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn go_history(_a: &AppHandle, _t: String, _forward: bool) -> Result<(), String> {
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
    pub fn eval(_a: &AppHandle, _t: String, _s: String) -> Result<String, String> {
        Err(MSG.into())
    }
    pub fn set_hidden(_a: &AppHandle, _t: String, _h: bool) -> Result<(), String> {
        Err(MSG.into())
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::{assert_no_bridge, create, destroy, eval, go_history, navigate, set_bounds, set_hidden};
