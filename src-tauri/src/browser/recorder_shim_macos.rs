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
//! **Assembled from two canonical assets** (audit 20260903 S-02): the recorder used
//! to compute roles and names with its own copy of the vocabulary, which drifted from
//! the replayer's (`aria.ts`), so it emitted locators the replayer could not resolve.
//! `agentCore.src.js` is the shared role/name helper set that BOTH the recorder and
//! the agent library are built from; `recorderShim.src.js` is the shim body. Rust
//! wraps the two in one IIFE, so the shipped bytes are those two files and nothing
//! else — `recorderShim.test.ts` executes the same pair in jsdom.
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

/// The page-world recorder shim: the shared core helpers, then the shim body, in
/// one IIFE. Editing the capture behaviour means editing `recorderShim.src.js`;
/// editing how a role or name is computed means editing `agentCore.src.js` — which
/// changes the replayer in the same stroke, which is the point.
const RECORDER_SHIM_SRC: &str = concat!(
    "(function(){\n",
    include_str!("../../../src/lib/browser/agent/agentCore.src.js"),
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

    /// The JavaScript with its `//` and `/* */` comments removed (string literals
    /// kept), so the pins below read CODE. The shared core's own header says "NO
    /// `.value` read anywhere" — a substring pin on the raw bytes would trip on the
    /// sentence that states the rule.
    fn code_only(src: &str) -> String {
        let bytes: Vec<char> = src.chars().collect();
        let mut out = String::with_capacity(src.len());
        let mut i = 0;
        let mut quote: Option<char> = None;
        while i < bytes.len() {
            let c = bytes[i];
            let next = bytes.get(i + 1).copied();
            match quote {
                Some(q) => {
                    out.push(c);
                    if c == '\\' {
                        if let Some(n) = next {
                            out.push(n);
                            i += 1;
                        }
                    } else if c == q {
                        quote = None;
                    }
                }
                None if c == '"' || c == '\'' => {
                    quote = Some(c);
                    out.push(c);
                }
                None if c == '/' && next == Some('/') => {
                    while i < bytes.len() && bytes[i] != '\n' {
                        i += 1;
                    }
                    continue;
                }
                None if c == '/' && next == Some('*') => {
                    i += 2;
                    while i + 1 < bytes.len() && !(bytes[i] == '*' && bytes[i + 1] == '/') {
                        i += 1;
                    }
                    i += 2;
                    continue;
                }
                None => out.push(c),
            }
            i += 1;
        }
        out
    }

    /// The assembled asset is the real recorder shim, not an empty or wrong file —
    /// the load-bearing invariants a bad include path or a gutted asset would break.
    #[test]
    fn assembled_asset_is_the_recorder_shim() {
        let code = code_only(RECORDER_SHIM_SRC);
        assert!(code.contains("__vmark_recorder_buffer"));
        assert!(code.contains("__vmark_recorder_armed"));
        // Dormant: capture is gated on the arm marker.
        assert!(code.contains("function armed()"));
        // No message handler: the no-bridge invariant (R3).
        assert!(!code.contains("webkit.messageHandlers"));
        // Never records a typed value — only the locator and a sensitivity hint.
        assert!(code.contains("sensitive"));
        assert!(
            !code.contains(".value"),
            "a `.value` read in the shim or the shared core would let a typed value \
             enter the recorder buffer"
        );
    }

    #[test]
    fn the_comment_stripper_keeps_code_and_strings_and_drops_comments() {
        let src = "var a = 1; // trailing .value\n/* block .value\n more */ var s = \"// not a comment\";";
        let code = code_only(src);
        assert!(!code.contains(".value"));
        assert!(code.contains("var a = 1;"));
        assert!(code.contains("\"// not a comment\""));
        // A `.value` in CODE is still seen — the pin is not blind.
        assert!(code_only("x = el.value; // ok").contains(".value"));
    }

    /// One IIFE around both files: the core's helpers are in scope for the body and
    /// nothing leaks onto the page's `window`.
    #[test]
    fn the_two_assets_are_wrapped_in_one_iife() {
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
