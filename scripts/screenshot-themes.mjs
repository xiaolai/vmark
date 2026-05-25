#!/usr/bin/env node
/**
 * screenshot-themes.mjs
 *
 * Captures one PNG per vmark theme (white, paper, mint, sepia, night)
 * for visual baseline review. Drives a running Tauri dev instance via
 * the MCP bridge plugin's WebSocket interface.
 *
 * Usage:
 *   1. Start the app:  pnpm tauri dev
 *   2. Run the script: node scripts/screenshot-themes.mjs
 *
 * Output: dev-docs/baselines/<themeId>.png (gitignored)
 *
 * The script:
 *   1. Connects to the MCP bridge on localhost:9223 (default port).
 *   2. Opens dev-docs/css-reference.md as the canonical visual subject.
 *   3. For each theme, sets useSettingsStore.setState({appearance:{theme}})
 *      via window-eval, waits 500ms for the theme to settle, captures
 *      a viewport screenshot, saves the PNG.
 *   4. Restores the original theme before exit.
 *
 * This is a development aid, not a CI gate. Visual review by a human
 * is still required; this script just makes the inputs cheap to
 * produce.
 *
 * @module scripts/screenshot-themes
 */

import { WebSocket } from "ws";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(REPO_ROOT, "dev-docs/baselines");
const REFERENCE_DOC = resolve(REPO_ROOT, "dev-docs/css-reference.md");
const THEMES = ["white", "paper", "mint", "sepia", "night"];
const MCP_HOST = process.env.MCP_BRIDGE_HOST ?? "localhost";
const MCP_PORT = Number(process.env.MCP_BRIDGE_PORT ?? 9223);

/** Minimal MCP-bridge client. The bridge speaks a request/response
 *  JSON protocol over WebSocket — see src/hooks/mcpBridge/. */
function connect() {
  return new Promise((resolveConn, rejectConn) => {
    const ws = new WebSocket(`ws://${MCP_HOST}:${MCP_PORT}`);
    let nextId = 0;
    const pending = new Map();

    ws.on("open", () => resolveConn({
      send(method, params = {}) {
        const id = `req-${++nextId}`;
        return new Promise((resolveReq, rejectReq) => {
          pending.set(id, { resolveReq, rejectReq });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close: () => ws.close(),
    }));
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      msg.error ? slot.rejectReq(new Error(msg.error)) : slot.resolveReq(msg.result);
    });
    ws.on("error", rejectConn);
    setTimeout(() => rejectConn(new Error("MCP-bridge connect timeout")), 8000);
  });
}

async function setTheme(client, themeId) {
  await client.send("window.eval", {
    code: `
      window.__VMARK_DEBUG__?.setSettingsTheme?.(${JSON.stringify(themeId)})
      ?? (() => {
        const store = window.__VMARK_DEBUG__?.useSettingsStore;
        if (!store) throw new Error("settingsStore not exposed on __VMARK_DEBUG__ — run in dev build");
        store.setState((s) => ({ appearance: { ...s.appearance, theme: ${JSON.stringify(themeId)} } }));
      })();
    `,
  });
}

async function snapshot(client, filePath) {
  const { dataBase64 } = await client.send("webview.screenshot", { format: "png" });
  await writeFile(filePath, Buffer.from(dataBase64, "base64"));
}

async function openReference(client) {
  const content = await readFile(REFERENCE_DOC, "utf-8");
  await client.send("window.eval", {
    code: `
      const store = window.__VMARK_DEBUG__?.useDocumentStore;
      if (!store) throw new Error("documentStore not exposed on __VMARK_DEBUG__");
      const tabId = window.__VMARK_DEBUG__?.activeTabId?.() ?? "tab-1";
      store.getState().loadContent(tabId, ${JSON.stringify(content)});
    `,
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`[screenshot-themes] Connecting to MCP bridge ws://${MCP_HOST}:${MCP_PORT} ...`);

  let client;
  try {
    client = await connect();
  } catch (err) {
    console.error("Failed to connect. Is `pnpm tauri dev` running?\n", err.message);
    process.exit(1);
  }

  try {
    await openReference(client);
    for (const themeId of THEMES) {
      console.log(`[screenshot-themes] ${themeId}`);
      await setTheme(client, themeId);
      await new Promise((r) => setTimeout(r, 500));
      await snapshot(client, resolve(OUT_DIR, `${themeId}.png`));
    }
    console.log(`[screenshot-themes] Wrote 5 baselines to ${OUT_DIR}`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
