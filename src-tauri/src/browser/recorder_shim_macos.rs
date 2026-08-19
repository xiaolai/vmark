//! Page-world recorder-capture shim injection (WI-NB7.1, native half).
//!
//! Registers a **dormant page-world** `WKUserScript` that captures user actions
//! (`click`/`change` LOCATORS — never typed values) into a capped ring buffer on a
//! hidden DOM element, but ONLY once the isolated-world driver has ARMED it by adding
//! a marker element. Mirrors `console_shim_macos.rs`: the isolated-world driver reads
//! the buffer via the ordinary eval primitive, so **no `WKScriptMessageHandler` is
//! registered and the no-bridge invariant (R3) holds**.
//!
//! Installed at config time on AiSandbox tabs ONLY — a human's page is never reshaped
//! — because a `WKUserScript` is configuration-time (it cannot be added after the
//! webview exists). It ships dormant precisely because of that: capture is gated on
//! the runtime marker, not on installation, so a tab that never records pays only for
//! two idle event listeners.
//!
//! CONTRACT: the buffer element id is `__vmark_recorder_buffer` (JSON array of
//! `{type, role?, name?, sensitive?}`) and the arm marker id is
//! `__vmark_recorder_armed`.

use crate::browser::registry::AutomationMode;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_foundation::NSString;
use objc2_web_kit::{
    WKContentWorld, WKUserScript, WKUserScriptInjectionTime, WKWebViewConfiguration,
};

/// The page-world recorder shim — ONE canonical asset. These are the exact bytes
/// `src/lib/browser/agent/recorderShim.test.ts` executes in jsdom, so the tested copy
/// IS the shipped copy. Editing the capture behaviour means editing
/// `recorderShim.src.js`, nothing here.
const RECORDER_SHIM_SRC: &str = include_str!("../../../src/lib/browser/agent/recorderShim.src.js");

/// Inject the dormant recorder shim into an AiSandbox tab's page world at document
/// start. A no-op for any other posture.
pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
) {
    if !matches!(mode, AutomationMode::AiSandbox) {
        return;
    }
    let source = NSString::from_str(RECORDER_SHIM_SRC);
    let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
    let script = unsafe {
        WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
            WKUserScript::alloc(mtm),
            &source,
            WKUserScriptInjectionTime::AtDocumentStart,
            false, // inject into all frames, not just the main frame
            &page_world,
        )
    };
    let controller = unsafe { config.userContentController() };
    unsafe { controller.addUserScript(&script) };
}

#[cfg(test)]
mod tests {
    use super::RECORDER_SHIM_SRC;

    /// The included asset is the real recorder shim, not an empty or wrong file — the
    /// load-bearing invariants a bad include path or a gutted asset would break.
    #[test]
    fn included_asset_is_the_recorder_shim() {
        assert!(RECORDER_SHIM_SRC.contains("__vmark_recorder_buffer"));
        assert!(RECORDER_SHIM_SRC.contains("__vmark_recorder_armed"));
        // Dormant: capture is gated on the arm marker.
        assert!(RECORDER_SHIM_SRC.contains("function armed()"));
        // No message handler: the no-bridge invariant (R3).
        assert!(!RECORDER_SHIM_SRC.contains("webkit.messageHandlers"));
        // Never records a typed value — only the locator and a sensitivity hint.
        assert!(RECORDER_SHIM_SRC.contains("sensitive"));
        assert!(!RECORDER_SHIM_SRC.contains(".value"));
    }
}
