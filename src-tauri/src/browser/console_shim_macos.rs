//! Page-world console-capture shim injection (native half).
//!
//! Registers a **page-world** `WKUserScript` that overrides `console.*` — and
//! captures uncaught errors / unhandled rejections — into a capped ring buffer
//! on a hidden DOM element. The isolated-world driver reads that element
//! (`consoleShim.ts` `buildConsoleReadScript`) — the DOM is shared across
//! content worlds, so **no `WKScriptMessageHandler` is registered and the no-bridge
//! invariant (R3) holds**.
//!
//! **Every AI-owned posture, never a human's page**: the shim
//! used to be AiSandbox-only, so `browser_read console` on an `ai-shared` tab
//! succeeded and read an empty buffer forever. The captured output is
//! page-controlled and untrusted; the read handler treats it like any `read`.
//!
//! **Main frame only.** The driver reads the buffer from the main frame (evals
//! target the main frame), so a copy in every subframe was written by pages and
//! read by nobody — and re-serialized the whole buffer on every log call in every
//! ad frame. Injecting into the main frame alone is what the reader can see.
//!
//! CONTRACT: the buffer element id is `__vmark_console_buffer` and its content
//! is a JSON array of `{level, text}`.

use crate::browser::registry::AutomationMode;
use objc2::MainThreadMarker;
use objc2_web_kit::WKWebViewConfiguration;

/// The page-world shim — ONE canonical asset. This includes the
/// exact bytes `src/lib/browser/agent/consoleShim.test.ts` executes in jsdom,
/// so the tested copy IS the shipped copy. Two hand-maintained duplicates used
/// to exist with nothing checking they agreed (audit 019fe61c); editing the
/// behaviour now means editing `consoleShim.src.js`, nothing here.
const CONSOLE_SHIM_SRC: &str = include_str!("../../../src/lib/browser/agent/consoleShim.src.js");

/// Only the frame the driver reads gets a buffer (see the module doc). Pinned at
/// compile time: flipping it back to every frame is a deliberate edit here, not a
/// drive-by.
const MAIN_FRAME_ONLY: bool = true;
// A compile-time pin: the constant IS the subject. Older clippy reports it as a constant assertion.
#[allow(clippy::assertions_on_constants)]
const _: () = assert!(MAIN_FRAME_ONLY);

/// Which postures receive the shim: every AI-owned one, and never a human's page.
pub(super) fn installs_for(mode: AutomationMode) -> bool {
    mode != AutomationMode::Human
}

/// Inject the console-capture shim into an AI-owned tab's main-frame page world at
/// document start. A no-op for a human tab.
pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
) {
    if !installs_for(mode) {
        return;
    }
    super::webkit_calls::add_page_world_script(config, mtm, CONSOLE_SHIM_SRC, MAIN_FRAME_ONLY);
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// An `ai-shared` tab's console read returned nothing,
    /// forever, because the shim was sandbox-only. A human's page is never reshaped.
    #[test]
    fn the_shim_installs_for_every_ai_posture_and_never_for_a_human() {
        assert!(installs_for(AutomationMode::AiSandbox));
        assert!(installs_for(AutomationMode::AiShared));
        assert!(!installs_for(AutomationMode::Human));
    }
}
