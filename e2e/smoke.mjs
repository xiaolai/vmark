#!/usr/bin/env node
/**
 * VMark E2E Smoke Harness — RW-13 (L12) · hardening v2-005
 *
 * Purpose: A minimal, runnable happy-path smoke test that drives a LIVE VMark
 * debug build through its Tauri MCP automation bridge. Audit L12 / WI v2-005
 * flagged that the repo had no executable E2E harness — this closes that gap
 * with the smallest correct thing: connect → confirm a window → type into the
 * editor → assert the content round-trips → capture a screenshot → clean exit.
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
 * Typing strategy: the bridge exposes `execute_js` but NO keyboard/click
 * primitive at the socket layer. We focus the ProseMirror contenteditable and
 * use `document.execCommand("insertText", ...)`, which fires the same
 * beforeinput/input events a real keystroke or paste would — ProseMirror
 * inserts it natively. We then read `.ProseMirror`'s textContent back out to
 * assert the edit round-tripped through the real editor.
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

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config (overridable via flags)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const cfg = {
    port: 9323,
    host: "127.0.0.1",
    timeoutMs: 15000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") cfg.port = Number(argv[++i]);
    else if (a === "--host") cfg.host = argv[++i];
    else if (a === "--timeout") cfg.timeoutMs = Number(argv[++i]);
  }
  return cfg;
}

const cfg = parseArgs(process.argv.slice(2));
const MARKER = `VMark smoke ${new Date().toISOString()}`;

// ---------------------------------------------------------------------------
// Minimal request/response client over the bridge WebSocket
// ---------------------------------------------------------------------------
class BridgeClient {
  #ws;
  #pending = new Map();
  #seq = 0;

  connect({ host, port, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const url = `ws://${host}:${port}`;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(new Error(`Failed to construct WebSocket for ${url}: ${err}`));
        return;
      }
      this.#ws = ws;

      const onTimeout = setTimeout(() => {
        reject(
          new Error(
            `Timed out connecting to the Tauri automation bridge at ${url} ` +
              `after ${timeoutMs}ms. Is the debug app running (pnpm tauri:dev)?`
          )
        );
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, timeoutMs);

      ws.addEventListener("open", () => {
        clearTimeout(onTimeout);
        resolve();
      });
      ws.addEventListener("error", (ev) => {
        clearTimeout(onTimeout);
        reject(
          new Error(
            `WebSocket error connecting to ${url}: ${ev?.message ?? ev}. ` +
              `Confirm the bridge is live on port ${port} (debug build only).`
          )
        );
      });
      ws.addEventListener("close", () => {
        // Reject any in-flight requests so callers don't hang.
        for (const [, p] of this.#pending) {
          p.reject(new Error("Bridge connection closed mid-request"));
        }
        this.#pending.clear();
      });
      ws.addEventListener("message", (ev) => this.#onMessage(ev));
    });
  }

  #onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return; // ignore non-JSON broadcast noise
    }
    // The bridge also broadcasts unsolicited events; only correlate replies
    // that carry an id we are waiting on.
    const id = msg?.id;
    if (id == null || !this.#pending.has(id)) return;
    const p = this.#pending.get(id);
    this.#pending.delete(id);
    p.resolve(msg);
  }

  send(command, args, timeoutMs) {
    const id = `smoke-${++this.#seq}`;
    const payload = JSON.stringify({ id, command, args: args ?? {} });
    return new Promise((resolve, reject) => {
      const onTimeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (m) => {
          clearTimeout(onTimeout);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(onTimeout);
          reject(e);
        },
      });
      try {
        this.#ws.send(payload);
      } catch (err) {
        clearTimeout(onTimeout);
        this.#pending.delete(id);
        reject(new Error(`Failed to send "${command}": ${err}`));
      }
    });
  }

  close() {
    try {
      this.#ws?.close();
    } catch {
      /* ignore */
    }
  }
}

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

/** Assert a bridge reply was successful; return its `.data`. */
function expectSuccess(reply, label) {
  if (!reply || reply.success !== true) {
    throw new Error(
      `${label} — bridge returned failure: ${reply?.error ?? JSON.stringify(reply)}`
    );
  }
  return reply.data;
}

/** Run a JS expression in the webview and return its evaluated value. */
async function evalJs(client, script) {
  const reply = await client.send("execute_js", { script }, cfg.timeoutMs);
  if (reply.success !== true) {
    throw new Error(`execute_js failed: ${reply.error ?? JSON.stringify(reply)}`);
  }
  return reply.data;
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
async function main() {
  console.error(`VMark E2E smoke — RW-13 (L12) — bridge ${cfg.host}:${cfg.port}`);
  const client = new BridgeClient();

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

  // Step 4 — create a fresh edit: clear the editor, focus it, type a marker.
  // execCommand("insertText") fires real beforeinput/input events, which
  // ProseMirror handles natively — the same path a keystroke/paste takes.
  const typed = await evalJs(
    client,
    `(() => {
       const el = document.querySelector(".ProseMirror");
       if (!el) return { ok: false, reason: "no editor" };
       el.focus();
       // Select all existing content, then replace with our marker.
       const sel = window.getSelection();
       const range = document.createRange();
       range.selectNodeContents(el);
       sel.removeAllRanges();
       sel.addRange(range);
       document.execCommand("insertText", false, ${JSON.stringify(MARKER)});
       return { ok: true, text: (el.textContent || "").trim() };
     })()`
  );
  if (!typed?.ok) {
    throw new Error(`Failed to type into editor: ${typed?.reason ?? "unknown"}`);
  }
  pass(`Typed marker text into the document`);

  // Step 5 — assert the editor content reflects what we typed.
  // Re-read after a short settle so ProseMirror's transaction has applied.
  await new Promise((r) => setTimeout(r, 250));
  const content = await evalJs(
    client,
    `(() => {
       const el = document.querySelector(".ProseMirror");
       return el ? (el.textContent || "") : "";
     })()`
  );
  if (typeof content !== "string" || !content.includes(MARKER)) {
    throw new Error(
      `Editor content does not contain the typed marker.\n` +
        `        expected to contain: ${JSON.stringify(MARKER)}\n` +
        `        actual: ${JSON.stringify(String(content).slice(0, 200))}`
    );
  }
  pass("Editor content reflects the typed marker (round-trip verified)");

  // Step 6 — capture a screenshot artifact of the live window.
  const shot = expectSuccess(
    await client.send(
      "capture_native_screenshot",
      { format: "png", windowLabel: "main" },
      cfg.timeoutMs
    ),
    "capture_native_screenshot"
  );
  const dataUrl = typeof shot === "string" ? shot : shot?.dataUrl ?? shot?.data;
  if (typeof dataUrl !== "string" || !dataUrl.includes("base64,")) {
    throw new Error(
      `Screenshot did not return a base64 data URL: ${JSON.stringify(shot).slice(0, 120)}`
    );
  }
  const base64 = dataUrl.slice(dataUrl.indexOf("base64,") + "base64,".length);
  const artifactsDir = join(__dirname, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const outPath = join(artifactsDir, "smoke.png");
  await writeFile(outPath, Buffer.from(base64, "base64"));
  pass(`Screenshot captured → ${outPath}`);

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
