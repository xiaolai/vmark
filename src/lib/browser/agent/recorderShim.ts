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
 * **Two canonical assets, one assembly** (audit 2026-09-03 S-02). The shim is a BODY
 * that assumes the shared perception core is in scope, so both hosts wrap the pair
 * identically: Rust `concat!`s `"(function(){\n"`, `agentCore.src.js`, `"\n"`,
 * `recorderShim.src.js`, `"\n})();"` (`src-tauri/src/browser/recorder_shim_macos.rs`),
 * and `RECORDER_SHIM_SRC` below is the same string, so `recorderShim.test.ts` and
 * `recorder.webkit.test.ts` execute the shipped bytes.
 *
 * **Drained events are never re-published** (S-01): the clearing drain stamps
 * `data-drain` on the buffer element, and the shim drops its closure copy when the
 * stamp it last saw has moved.
 *
 * @coordinates-with src-tauri/src/browser/recorder_shim_macos.rs — injects the same assembly
 * @coordinates-with lib/browser/agent/agentCore.ts — the core asset
 * @coordinates-with lib/browser/agent/shimDrain.ts — the drain stamp
 * @coordinates-with services/workflow/recorderSession.ts — the drain/arm orchestrator
 * @module lib/browser/agent/recorderShim
 */

import RECORDER_SHIM_BODY from "./recorderShim.src.js?raw";
import { AGENT_CORE_SRC } from "./agentCore";
import { bumpDrainStamp } from "./shimDrain";

/** The shim BODY — the exact bytes of `recorderShim.src.js`, which assume the core. */
export { RECORDER_SHIM_BODY };

/** The page-world shim as injected: core + body in one IIFE, byte-identical to
 *  Rust's `concat!` in `recorder_shim_macos.rs`. */
export const RECORDER_SHIM_SRC = `(function(){\n${AGENT_CORE_SRC}\n${RECORDER_SHIM_BODY}\n})();`;

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
 * cleared or corrupted the buffer just yields `[]` — the reader never throws. A
 * clearing drain also bumps the drain stamp, which is what makes the clear stick
 * (S-01): the shim resets its closure copy when it sees the stamp move.
 */
export function buildRecorderDrainScript(clear: boolean): string {
  return (
    `var e=document.getElementById(${JSON.stringify(RECORDER_BUFFER_ID)});var b=[];` +
    `if(e){try{b=JSON.parse(e.textContent||"[]");}catch(x){}}` +
    (clear ? `if(e){e.textContent="[]";${bumpDrainStamp("e")}}` : "") +
    `return JSON.stringify({events:b});`
  );
}
