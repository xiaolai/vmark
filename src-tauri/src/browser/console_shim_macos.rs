//! Page-world console-capture shim injection (WI-P7.1, native half).
//!
//! Registers a **page-world** `WKUserScript` that overrides `console.*` into a
//! capped ring buffer on a hidden DOM element. The isolated-world driver reads that
//! element (`consoleShim.ts` `buildConsoleReadScript`) — the DOM is shared across
//! content worlds, so **no `WKScriptMessageHandler` is registered and the no-bridge
//! invariant (R3) holds** (see `dev-docs/grills/browser-automation/phase7-console-design.md`).
//!
//! Sandbox tabs ONLY — a human's page is never reshaped. The captured output is
//! page-controlled and untrusted; the read handler treats it like any `read`.
//!
//! CONTRACT (kept in sync with the unit-tested TS source of truth,
//! `src/lib/browser/agent/consoleShim.ts`): the buffer element id is
//! `__vmark_console_buffer` and its content is a JSON array of `{level, text}`.

use crate::browser::registry::AutomationMode;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_foundation::NSString;
use objc2_web_kit::{
    WKContentWorld, WKUserScript, WKUserScriptInjectionTime, WKWebViewConfiguration,
};

/// The page-world shim. Mirrors `installConsoleCapture` in `consoleShim.ts`; the
/// TS version is the unit-tested source of truth for this behaviour.
const CONSOLE_SHIM_SRC: &str = r#"(function(){
var ID="__vmark_console_buffer",MAX=2000,CAP=200,buf=[];
function el(){var e=document.getElementById(ID);if(!e){e=document.createElement("script");e.type="application/json";e.id=ID;e.style.display="none";(document.head||document.documentElement).appendChild(e);}return e;}
function push(level,args){var t="";try{t=Array.prototype.map.call(args,function(a){if(typeof a==="string")return a;try{return JSON.stringify(a);}catch(e){return String(a);}}).join(" ");}catch(e){t="";}buf.push({level:level,text:t.slice(0,MAX)});if(buf.length>CAP)buf.shift();try{el().textContent=JSON.stringify(buf);}catch(e){}}
["log","info","warn","error","debug"].forEach(function(level){var orig=console[level];console[level]=function(){try{push(level,arguments);}catch(e){}if(typeof orig==="function")return orig.apply(console,arguments);};});
})();"#;

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
