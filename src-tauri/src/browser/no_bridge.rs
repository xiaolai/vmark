//! The R3 / SPIKE-1 no-bridge assertion (ADR-B2).
//!
//! VMark constructs its own `WKWebView` rather than asking Tauri for one, so
//! Tauri's IPC bridge is never injected into a browsed page. That is the single
//! load-bearing privacy claim of the embedded browser: without it, any site the
//! user visits gets a channel into the app.
//!
//! This script is the permanent regression check for that claim. It lives in its
//! own module because it is a SPEC ARTIFACT — it belongs neither to the `Send`
//! state container nor to the macOS driver, and parking it in either made that
//! file outgrow the size gate.
//!
//! It must run in the PAGE world, not the driver's isolated world: the isolated
//! world never has the bridge regardless, so checking from there would report
//! "clean" no matter what had leaked.
//!
//! @coordinates-with e2e/journeys/31-browser-no-bridge.mjs — the E2E that runs it

/// The read-only JS that asserts no Tauri bridge leaked into the browsed page
/// (R3 / SPIKE-1). Returns a JSON object of booleans; all must be false.
pub const NO_BRIDGE_ASSERTION: &str = "return JSON.stringify({\
    hasTauriInternals: typeof window.__TAURI_INTERNALS__ !== 'undefined',\
    hasTauri: typeof window.__TAURI__ !== 'undefined',\
    hasIpc: typeof window.ipc !== 'undefined',\
    invokeReachable: (function(){try{return typeof window.__TAURI_INTERNALS__.invoke==='function';}catch(e){return false;}})()\
});";
