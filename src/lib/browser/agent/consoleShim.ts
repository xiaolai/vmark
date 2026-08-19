/**
 * Console capture (WI-P7.1 / WI-NB3.1) — Option C from the Phase 7 design review
 * (`dev-docs/grills/browser-automation/phase7-console-design.md`).
 *
 * A page-world shim overrides `console.*` — and captures uncaught errors and
 * unhandled promise rejections — appending each entry to a **capped ring buffer**
 * stored on a hidden DOM element. The isolated-world driver reads that element
 * with the ordinary eval primitive. The DOM is shared across content worlds, so
 * nothing here registers a `WKScriptMessageHandler` — **the no-bridge invariant
 * (R3) holds**: the page still has no channel into VMark.
 *
 * The shim runs in the PAGE's own world, so captured output is page-controlled
 * and **untrusted** — treat it exactly like a `read` result (never an act
 * target). The buffer is bounded so a chatty/hostile page can't grow the DOM
 * without limit.
 *
 * **One canonical asset.** The shim source lives in `consoleShim.src.js` and is
 * consumed twice, byte-identical: Rust `include_str!`s it for injection
 * (`src-tauri/src/browser/console_shim_macos.rs`), and `consoleShim.test.ts`
 * executes it in jsdom. Two hand-maintained copies of this behaviour used to
 * exist — the tested one was not the shipped one, and nothing checked they
 * agreed (audit 019fe61c). This module re-exports the asset so the TS side has
 * a typed name for the same bytes.
 *
 * @coordinates-with src-tauri/src/browser/console_shim_macos.rs — injects the asset
 * @coordinates-with services/mcpBridge/v2/browserConsole.ts — the read handler
 * @module lib/browser/agent/consoleShim
 */

import CONSOLE_SHIM_SRC from "./consoleShim.src.js?raw";

/** The page-world shim source — the exact bytes Rust injects. */
export { CONSOLE_SHIM_SRC };

/** Id of the hidden DOM element that holds the JSON ring buffer. */
export const CONSOLE_BUFFER_ID = "__vmark_console_buffer";

/**
 * Isolated-world script that reads (and optionally clears) the console ring buffer.
 * Returns `JSON.stringify({entries:[{level,text},...]})`. A page that cleared or
 * corrupted the buffer just yields `[]` — the reader never throws.
 */
export function buildConsoleReadScript(clear: boolean): string {
  return (
    `var e=document.getElementById(${JSON.stringify(CONSOLE_BUFFER_ID)});var b=[];` +
    `if(e){try{b=JSON.parse(e.textContent||"[]");}catch(x){}}` +
    (clear ? 'if(e)e.textContent="[]";' : "") +
    `return JSON.stringify({entries:b});`
  );
}
