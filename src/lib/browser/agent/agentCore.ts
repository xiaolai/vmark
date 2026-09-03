/**
 * The shared perception core's typed name (audit 2026-09-03, S-02).
 *
 * Purpose: give the TypeScript side ONE import for the raw ES5 asset
 * `agentCore.src.js` — the role / accessible-name / visibility / composed-walk
 * functions that both the isolated-world agent library (`agentLib.ts`) and the
 * page-world recorder shim (`recorderShim.ts`, mirroring Rust's `concat!`)
 * prepend. Same pattern as `consoleShim.ts`: the asset is imported `?raw`, so the
 * tested bytes are the shipped bytes and there is no second copy to drift.
 *
 * @coordinates-with lib/browser/agent/agentCore.src.js — the asset itself
 * @coordinates-with lib/browser/agent/agentLib.ts — prepends it to every driver script
 * @coordinates-with lib/browser/agent/recorderShim.ts — wraps it with the shim body
 * @coordinates-with src-tauri/src/browser/recorder_shim_macos.rs — concat!s the same file
 * @module lib/browser/agent/agentCore
 */

import AGENT_CORE_SRC from "./agentCore.src.js?raw";

/** The core asset — function declarations only, `__vmark`-prefixed, ES5. */
export { AGENT_CORE_SRC };
