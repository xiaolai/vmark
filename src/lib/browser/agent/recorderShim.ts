/**
 * Recorder capture (WI-NB7.1) — the isolated-world side of the page-world recorder
 * shim, mirroring the console-shim pattern.
 *
 * A page-world shim (`recorderShim.src.js`) captures `click`/`change` LOCATORS into a
 * capped ring buffer on a hidden DOM element, but only while ARMED. This module is the
 * typed name for the same bytes plus the three isolated-world scripts the host runs
 * through the ordinary `browser_eval` primitive: arm, disarm, and drain. The DOM is
 * shared across content worlds, so nothing here registers a `WKScriptMessageHandler` —
 * the no-bridge invariant (R3) holds.
 *
 * The buffer NEVER holds a typed value — only the locator and a `sensitive` hint — so
 * a drained buffer cannot leak a secret. Trusted host-side redaction (`recorder.ts`)
 * makes the final serialization decision.
 *
 * **One canonical asset.** The shim source lives in `recorderShim.src.js`, consumed
 * byte-identical twice: Rust `include_str!`s it for injection
 * (`src-tauri/src/browser/recorder_shim_macos.rs`), and `recorderShim.test.ts` executes
 * it in jsdom.
 *
 * @coordinates-with src-tauri/src/browser/recorder_shim_macos.rs — injects the asset
 * @coordinates-with services/workflow/recorderSession.ts — the drain/arm orchestrator
 * @module lib/browser/agent/recorderShim
 */

import RECORDER_SHIM_SRC from "./recorderShim.src.js?raw";

/** The page-world shim source — the exact bytes Rust injects. */
export { RECORDER_SHIM_SRC };

/** Id of the hidden DOM element that holds the JSON ring buffer of captured events. */
export const RECORDER_BUFFER_ID = "__vmark_recorder_buffer";

/** Id of the hidden marker element whose presence ARMS the page-world shim. */
export const RECORDER_ARMED_ID = "__vmark_recorder_armed";

/**
 * Isolated-world script that ARMS the shim (idempotent): adds the hidden marker the
 * shim checks before capturing. Run on record start and re-run after every navigation
 * while recording — a new document lost the marker with the old buffer.
 */
export function buildArmScript(): string {
  return (
    `var id=${JSON.stringify(RECORDER_ARMED_ID)};` +
    `if(!document.getElementById(id)){var e=document.createElement("script");` +
    `e.type="application/json";e.id=id;e.style.display="none";` +
    `(document.head||document.documentElement).appendChild(e);}` +
    `return "armed";`
  );
}

/** Isolated-world script that DISARMS the shim: removes the marker so capture stops. */
export function buildDisarmScript(): string {
  return (
    `var e=document.getElementById(${JSON.stringify(RECORDER_ARMED_ID)});` +
    `if(e&&e.parentNode)e.parentNode.removeChild(e);` +
    `return "disarmed";`
  );
}

/**
 * Isolated-world script that reads (and optionally clears) the recorder ring buffer.
 * Returns `JSON.stringify({events:[{type,role?,name?,sensitive?},...]})`. A page that
 * cleared or corrupted the buffer just yields `[]` — the reader never throws.
 */
export function buildRecorderDrainScript(clear: boolean): string {
  return (
    `var e=document.getElementById(${JSON.stringify(RECORDER_BUFFER_ID)});var b=[];` +
    `if(e){try{b=JSON.parse(e.textContent||"[]");}catch(x){}}` +
    (clear ? 'if(e)e.textContent="[]";' : "") +
    `return JSON.stringify({events:b});`
  );
}
