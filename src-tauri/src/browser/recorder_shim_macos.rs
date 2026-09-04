//! Page-world recorder-capture shim injection (WI-NB7.1, native half).
//!
//! Registers a **dormant page-world** `WKUserScript` that captures user actions
//! (`click`/`change` LOCATORS — never typed values) into a capped ring buffer on a
//! hidden DOM element, but ONLY once the isolated-world driver has ARMED it by adding
//! a marker element. Mirrors `console_shim_macos.rs`: the isolated-world driver reads
//! the buffer via the ordinary eval primitive, so **no `WKScriptMessageHandler` is
//! registered and the no-bridge invariant (R3) holds**.
//!
//! Installed at config time on **every AI-owned tab** (audit 20260903 S-06 — it was
//! AiSandbox-only, so recording an `ai-shared` tab started fine and captured nothing
//! on every drain) and never on a human's page, because a `WKUserScript` is
//! configuration-time (it cannot be added after the webview exists). It ships
//! dormant precisely because of that: capture is gated on the runtime marker, not on
//! installation, so a tab that never records pays only for two idle event listeners.
//!
//! **Assembled from the canonical assets** (audit 20260903 S-02): the recorder used
//! to compute roles and names with its own copy of the vocabulary, which drifted from
//! the replayer's (`aria.ts`), so it emitted locators the replayer could not resolve.
//! `agentCore.src.js` (+ `agentCoreRoles.src.js`) is the shared role/name helper set
//! that BOTH the recorder and the agent library are built from; `recorderShim.src.js`
//! is the shim body. Rust wraps them in one IIFE (the list and its order are on
//! `RECORDER_SHIM_SRC`), so the shipped bytes are those files and nothing else.
//! `recorderShim.test.ts` executes the same assembly in jsdom and pins what the shim
//! DOES — dormant until armed, no message handler, never a `.value` read — and
//! `recorderShimRustParity.test.ts` proves the two assemblies are byte-identical, so
//! those invariants are stated ONCE, there; the tests here check only what Rust adds
//! (the includes resolve to the real shim, one wrapper, which postures get it).
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

/// The page-world recorder shim: the shared core helpers (two files), the shim's
/// sensitivity helpers, then the shim body, in one IIFE — the SAME four assets in
/// the same order as `recorderShim.ts` (`RECORDER_SHIM_ASSETS`), pinned by
/// `recorderShimRustParity.test.ts`. Editing the capture behaviour means editing
/// `recorderShim.src.js`; editing how a role or name is computed means editing
/// `agentCore.src.js` — which changes the replayer in the same stroke, which is
/// the point. When the core was split into two files this list was not updated,
/// and the injected shim referenced helpers it did not carry; the parity test is
/// what makes that class fail here instead of in a page.
const RECORDER_SHIM_SRC: &str = concat!(
    "(function(){\n",
    include_str!("../../../src/lib/browser/agent/agentCore.src.js"),
    "\n",
    include_str!("../../../src/lib/browser/agent/agentCoreRoles.src.js"),
    "\n",
    include_str!("../../../src/lib/browser/agent/recorderShimSensitivity.src.js"),
    "\n",
    include_str!("../../../src/lib/browser/agent/recorderShim.src.js"),
    "\n})();"
);

/// Which postures receive the shim: every AI-owned one, and never a human's page.
pub(super) fn installs_for(mode: AutomationMode) -> bool {
    mode != AutomationMode::Human
}

/// Inject the dormant recorder shim into an AI-owned tab's page world at document
/// start. A no-op for a human tab.
pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
) {
    if !installs_for(mode) {
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
    use super::*;

    /// The include paths resolve to the real shim, not an empty or wrong file: the
    /// assembled string carries the two ids the CONTRACT names. Everything about
    /// the shim's BEHAVIOUR is pinned on the identical bytes by `recorderShim.test.ts`
    /// and `agentCore.test.ts` (with `recorderShimRustParity.test.ts` proving the
    /// bytes identical), so it is not restated here — the copy that used to be
    /// carried a 43-line comment stripper of its own to keep from tripping on the
    /// core's header sentence, and could drift from the canonical pins.
    #[test]
    fn the_included_assets_are_the_recorder_shim() {
        assert!(RECORDER_SHIM_SRC.contains("__vmark_recorder_buffer"));
        assert!(RECORDER_SHIM_SRC.contains("__vmark_recorder_armed"));
    }

    /// One IIFE around every asset: the core's helpers are in scope for the body and
    /// nothing leaks onto the page's `window`. The body carries its own inner IIFE,
    /// so the wrapper is asserted by position, not by count.
    #[test]
    fn the_assets_are_wrapped_in_one_iife() {
        assert!(RECORDER_SHIM_SRC.starts_with("(function(){\n"));
        assert!(RECORDER_SHIM_SRC.ends_with("\n})();"));
    }

    /// Audit 20260903 S-06: recording an `ai-shared` tab silently captured nothing
    /// because the shim was sandbox-only. A human's page is never reshaped.
    #[test]
    fn the_shim_installs_for_every_ai_posture_and_never_for_a_human() {
        assert!(installs_for(AutomationMode::AiSandbox));
        assert!(installs_for(AutomationMode::AiShared));
        assert!(!installs_for(AutomationMode::Human));
    }
}
