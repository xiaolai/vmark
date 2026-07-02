#!/usr/bin/env node
/**
 * VMark E2E Smoke Harness — RW-13 (L12) · hardening v2-005
 *
 * Purpose: A minimal, runnable happy-path smoke test that drives a LIVE VMark
 * debug build through its Tauri MCP automation bridge. Audit L12 / WI v2-005
 * flagged that the repo had no executable E2E harness — this closes that gap
 * with the smallest correct thing: connect → confirm a window → type into a
 * SCRATCH tab → assert the content round-trips → capture a screenshot →
 * discard the scratch tab → clean exit.
 *
 * Why the Tauri MCP automation bridge (NOT Chrome DevTools): VMark is a Tauri
 * desktop app, not a browser page. Per AGENTS.md, the automation bridge
 * (`tauri-plugin-mcp-bridge`, debug-only) is pinned to 127.0.0.1:9323 in
 * `src-tauri/src/lib.rs`. Port 9223 is VMark's OWN, auth-protected MCP server
 * (sidecar ↔ webview) — sending commands there drops with "Connection closed".
 * This harness talks to 9323 ONLY.
 *
 * Wire protocol (verified against tauri-plugin-mcp-bridge 0.8 `websocket.rs`):
 *   - The bridge is a plain WebSocket server on 127.0.0.1:9323.
 *   - Request:  { "id": "<unique>", "command": "<name>", "args": { ... } }
 *   - Response: { "id", "success": bool, "data"?: <json>, "error"?: <string> }
 *   - Commands used here: list_windows, execute_js, capture_native_screenshot.
 *
 * Zero runtime dependencies: uses Node's built-in global `WebSocket` (stable in
 * Node >= 22; this repo runs Node 22). No `ws` package, no MCP client lib.
 *
 * SAFETY MODEL (shared with the journey suite — see e2e/README.md): this test
 * NEVER types into or clears a pre-existing tab. It creates its own scratch
 * tab (verifiably empty before typing), types the marker there via
 * `document.execCommand("insertText")` — the same beforeinput/input path a
 * real keystroke takes — and force-discards ONLY that scratch tab in
 * teardown, restoring the original tab state exactly.
 *
 * Prerequisites (see e2e/README.md):
 *   1. A LIVE VMark debug build with the 9323 bridge — `pnpm tauri:dev`.
 *   2. A HEADED environment (a real display). The bridge captures a native
 *      screenshot of the window; this cannot run on a headless CI runner
 *      without a virtual display.
 *
 * Usage:
 *   pnpm e2e:smoke
 *   # or:  node e2e/smoke.mjs
 *   # options: --port 9323  --host 127.0.0.1  --timeout 15000
 *
 * Exit codes: 0 = all steps passed; non-zero = any failure (connection,
 * assertion, or timeout). Every step logs PASS/FAIL to stderr.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BridgeClient, expectSuccess, evalJs as evalJsWithTimeout } from "./lib/bridge.mjs";
import { parseArgs } from "./lib/config.mjs";
import { writeScreenshot } from "./lib/artifacts.mjs";
import {
  withTabRestore,
  createScratchTab,
  typeInActiveEditor,
  getEditorText,
  poll,
} from "./lib/vmark.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const USAGE =
  "Usage: node e2e/smoke.mjs [--port 9323] [--host 127.0.0.1] [--timeout 15000]";
const cfg = parseArgs(process.argv.slice(2), { usage: USAGE });
const MARKER = `VMark smoke ${new Date().toISOString()}`;

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------
let stepNo = 0;
function pass(label) {
  console.error(`  PASS  [${++stepNo}] ${label}`);
}
function fail(label, detail) {
  console.error(`  FAIL  [${++stepNo}] ${label}${detail ? `\n        ${detail}` : ""}`);
}

/** Run a JS expression in the webview and return its evaluated value. */
function evalJs(client, script) {
  return evalJsWithTimeout(client, script, cfg.timeoutMs);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
async function main() {
  console.error(`VMark E2E smoke — RW-13 (L12) — bridge ${cfg.host}:${cfg.port}`);
  const client = new BridgeClient({ idPrefix: "smoke" });

  // Step 1 — connect to the automation bridge.
  await client.connect(cfg);
  pass(`Connected to Tauri automation bridge (${cfg.host}:${cfg.port})`);

  // Step 2 — confirm at least one window/webview is present.
  const windows = expectSuccess(
    await client.send("list_windows", {}, cfg.timeoutMs),
    "list_windows"
  );
  const windowList = Array.isArray(windows) ? windows : windows?.windows;
  if (!Array.isArray(windowList) || windowList.length === 0) {
    throw new Error(`No windows reported by the bridge: ${JSON.stringify(windows)}`);
  }
  pass(`Window present (${windowList.length} window(s) reported)`);

  // Step 3 — confirm the editor webview is loaded and reachable.
  const editorReady = await evalJs(
    client,
    `(() => {
       const el = document.querySelector(".ProseMirror");
       return {
         hasEditor: !!el,
         tauriEvent: typeof window?.__TAURI__?.event?.emit === "function",
       };
     })()`
  );
  if (!editorReady?.hasEditor) {
    throw new Error(
      "No .ProseMirror editor surface found in the webview. " +
        "The app may still be booting, or the document window is not focused."
    );
  }
  if (!editorReady?.tauriEvent) {
    throw new Error(
      "window.__TAURI__.event.emit is unavailable — execute_js cannot return " +
        "results. Confirm this is the document window of a debug build."
    );
  }
  pass("Editor webview reachable (.ProseMirror present, IPC result channel live)");

  // Steps 4-7 — all editing happens in a journey-owned scratch tab.
  // withTabRestore force-discards it afterwards and asserts the tab bar is
  // byte-identical to the pre-test snapshot: the user's own tabs are never
  // typed into, cleared, or left dirty.
  await withTabRestore(client, async ({ track }) => {
    // Step 4 — create a fresh, verifiably empty scratch tab.
    const scratch = await createScratchTab(client);
    track(scratch.id);
    pass(`Scratch tab created (${scratch.id}, "${scratch.title}") — user tabs untouched`);

    // Step 5 — type a marker into the scratch tab. mustBeEmpty re-proves the
    // document is empty at insertion time; the helper also waits for the
    // dirty dot, i.e. the editor→store sync verifiably landed.
    await typeInActiveEditor(client, MARKER, { mustBeEmpty: true });
    pass("Typed marker text into the scratch document");

    // Step 6 — assert the editor content reflects what we typed (poll until
    // ProseMirror's transaction has applied; no fixed sleeps).
    await poll(
      () => getEditorText(client),
      (t) => typeof t === "string" && t.includes(MARKER),
      "typed marker to round-trip through the editor"
    );
    pass("Editor content reflects the typed marker (round-trip verified)");

    // Step 7 — capture a screenshot artifact of the live window.
    const outPath = await writeScreenshot(
      client,
      join(__dirname, "artifacts", "smoke.png"),
      cfg.timeoutMs
    );
    pass(`Screenshot captured → ${outPath}`);
  });
  pass("Scratch tab discarded — original tab state restored exactly");

  client.close();
  console.error("\nSMOKE PASSED — all steps green.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    fail("smoke aborted", err?.message ?? String(err));
    console.error("\nSMOKE FAILED.");
    process.exit(1);
  });
