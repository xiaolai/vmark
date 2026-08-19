//! Page-world console-capture shim injection (WI-P7.1 / WI-NB3.1, native half).
//!
//! Registers a **page-world** `WKUserScript` that overrides `console.*` — and
//! captures uncaught errors / unhandled rejections — into a capped ring buffer
//! on a hidden DOM element. The isolated-world driver reads that element
//! (`consoleShim.ts` `buildConsoleReadScript`) — the DOM is shared across
//! content worlds, so **no `WKScriptMessageHandler` is registered and the no-bridge
//! invariant (R3) holds** (see `dev-docs/grills/browser-automation/phase7-console-design.md`).
//!
//! Sandbox tabs ONLY — a human's page is never reshaped. The captured output is
//! page-controlled and untrusted; the read handler treats it like any `read`.
//!
//! CONTRACT: the buffer element id is `__vmark_console_buffer` and its content
//! is a JSON array of `{level, text}`.

use crate::browser::registry::AutomationMode;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_foundation::NSString;
use objc2_web_kit::{
    WKContentWorld, WKUserScript, WKUserScriptInjectionTime, WKWebViewConfiguration,
};

/// The page-world shim — ONE canonical asset (WI-NB3.1). This includes the
/// exact bytes `src/lib/browser/agent/consoleShim.test.ts` executes in jsdom,
/// so the tested copy IS the shipped copy. Two hand-maintained duplicates used
/// to exist with nothing checking they agreed (audit 019fe61c); editing the
/// behaviour now means editing `consoleShim.src.js`, nothing here.
const CONSOLE_SHIM_SRC: &str = include_str!("../../../src/lib/browser/agent/consoleShim.src.js");

/// Inject the console-capture shim into an AiSandbox tab's page world at document
/// start. A no-op for any other posture.
pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
) {
    if !matches!(mode, AutomationMode::AiSandbox) {
        return;
    }
    let source = NSString::from_str(CONSOLE_SHIM_SRC);
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
    use super::CONSOLE_SHIM_SRC;

    /// The included asset is the real shim, not an empty or wrong file — the
    /// load-bearing invariants a bad include path or a gutted asset would break.
    #[test]
    fn included_asset_is_the_console_shim() {
        assert!(CONSOLE_SHIM_SRC.contains("__vmark_console_buffer"));
        assert!(CONSOLE_SHIM_SRC.contains("unhandledrejection"));
        assert!(CONSOLE_SHIM_SRC.contains("addEventListener(\"error\""));
        // No message handler: the no-bridge invariant is about what the shim
        // does NOT do.
        assert!(!CONSOLE_SHIM_SRC.contains("webkit.messageHandlers"));
    }
}
