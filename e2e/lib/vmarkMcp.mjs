/**
 * VMark MCP client for E2E — drives the REAL sidecar over stdio (ADR-BR1).
 *
 * `AGENTS.md` requires AI-driven features to be tested through VMark MCP
 * "exclusively — that is the surface that ships". The Tauri bridge client
 * (`e2e/lib/bridge.mjs`) cannot do this: it speaks the debug automation socket on
 * 9323, which is a different surface with different semantics.
 *
 * Why the sidecar and not a raw WebSocket to VMark's own bridge: a raw client would
 * skip MCP initialize, tool discovery, and — most importantly — the ~455 lines of
 * argument validation and error transformation in `vmark-mcp-server/src/tools/
 * browser.ts`. That layer ships. A test that bypasses it tests a path no user takes.
 *
 * HONEST SCOPE LIMIT: this runs `dist/cli.js` under the local Node, not the
 * `pkg`-built binary that ships in the app bundle. It exercises real sidecar logic;
 * it does not prove the packaging. Do not describe it as "the full shipping path".
 *
 * THE FAILURE MODE THIS FILE EXISTS TO PREVENT: `dist/` is a build artifact and can
 * be arbitrarily old (it was a week stale when this was written). A harness that
 * merely checks `dist/cli.js` exists would silently test last week's code and pass.
 * So `startVmarkMcp()` REBUILDS from the working tree every run, and refuses to
 * start if the build fails.
 *
 * @coordinates-with vmark-mcp-server/src/cli.ts — the process spawned here
 * @coordinates-with vmark-mcp-server/src/utils/portFile.ts — how it finds VMark
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SIDECAR_DIR = join(REPO_ROOT, "vmark-mcp-server");
const SIDECAR_ENTRY = join(SIDECAR_DIR, "dist", "cli.js");

/** MCP protocol version the SDK server in this repo speaks. */
const PROTOCOL_VERSION = "2024-11-05";

/** Outer per-call cap. The sidecar's own bridge request timeout is 25s
 *  (`websocket.ts:64`); this must exceed it so a real bridge timeout surfaces as
 *  the sidecar's error rather than as our own, less informative, one. */
const CALL_TIMEOUT_MS = 40_000;

/** VMark's port file — `{port}:{token}`, rewritten on every app launch. */
function portFilePath() {
  const id = process.env.VMARK_APP_IDENTIFIER || "app.vmark";
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", id, "mcp-port");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), id, "mcp-port");
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), id, "mcp-port");
}

/**
 * Is VMark's own MCP bridge up and advertising a port?
 *
 * `cli.ts` attempts its WebSocket connection BEFORE starting the MCP stdio
 * transport, so spawning the sidecar against a dead/stale port file stalls
 * initialization for the full 10s connection timeout. Checking first turns that
 * into a fast, legible failure.
 */
export async function bridgeReady() {
  try {
    const raw = (await readFile(portFilePath(), "utf8")).trim();
    const port = Number.parseInt(raw.split(":")[0], 10);
    return Number.isInteger(port) && port > 0 && port <= 65535;
  } catch {
    return false;
  }
}

/** Rebuild the sidecar from the working tree. See the header. */
async function rebuildSidecar() {
  const child = spawn("pnpm", ["exec", "tsc"], {
    cwd: SIDECAR_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  child.stdout.on("data", (d) => (err += d));
  const [code] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`sidecar build failed (tsc exit ${code}):\n${err.trim()}`);
  }
}

/**
 * Spawn the sidecar and complete the MCP handshake.
 *
 * @returns {Promise<{
 *   callTool: (name: string, args?: object) => Promise<any>,
 *   listTools: () => Promise<Array<{name: string}>>,
 *   stderr: () => string,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startVmarkMcp({ rebuild = true } = {}) {
  if (rebuild) await rebuildSidecar();

  const child = spawn(process.execPath, [SIDECAR_ENTRY], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  // stdout is PROTOCOL ONLY. Anything the sidecar logs must go to stderr, or the
  // JSON-RPC stream is corrupted; capturing it separately also makes a sidecar
  // crash legible instead of appearing as a silent hang.
  let stderrBuf = "";
  child.stderr.on("data", (d) => (stderrBuf += d.toString()));

  const pending = new Map();
  let nextId = 1;
  let buf = "";

  // MCP stdio framing is newline-delimited JSON — NOT LSP-style Content-Length.
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // non-protocol noise on stdout; ignore rather than die
      }
      const entry = pending.get(msg.id);
      if (!entry) continue;
      pending.delete(msg.id);
      entry.resolve(msg);
    }
  });

  const exited = once(child, "exit").then(([code]) => {
    for (const [, p] of pending) {
      p.reject(new Error(`sidecar exited (code ${code}) mid-request.\nstderr:\n${stderrBuf.trim()}`));
    }
    pending.clear();
  });

  function send(method, params) {
    const id = nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${CALL_TIMEOUT_MS}ms.\nstderr:\n${stderrBuf.trim()}`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolvePromise(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  // Handshake: initialize, then the initialized notification. `tools/call` before
  // this is a protocol error.
  const init = await send("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "vmark-e2e", version: "1.0.0" },
  });
  if (init.error) {
    throw new Error(`MCP initialize failed: ${JSON.stringify(init.error)}\nstderr:\n${stderrBuf.trim()}`);
  }
  notify("notifications/initialized", {});

  return {
    async listTools() {
      const reply = await send("tools/list", {});
      if (reply.error) throw new Error(`tools/list failed: ${JSON.stringify(reply.error)}`);
      return reply.result?.tools ?? [];
    },

    /**
     * Call a tool and return `{ isError, text, json }`.
     *
     * NOTE the shape. `mcpAdapters.ts` returns only `content` + `isError`; the
     * app-side `data.needsApproval` does NOT survive to the MCP boundary — it is
     * rendered into the error TEXT by `toErrorResult`. Journeys must assert on
     * `text`, and treat a successful RETRY as the only proof that authority was
     * actually minted in Rust.
     */
    async callTool(name, args = {}) {
      const reply = await send("tools/call", { name, arguments: args });
      if (reply.error) {
        return { isError: true, text: JSON.stringify(reply.error), json: undefined };
      }
      const result = reply.result ?? {};
      const text = (result.content ?? [])
        .filter((c) => c?.type === "text")
        .map((c) => c.text)
        .join("\n");
      let json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined; // many results are prose, not JSON
      }
      return { isError: result.isError === true, text, json, content: result.content ?? [] };
    },

    stderr: () => stderrBuf,

    async close() {
      try {
        child.stdin.end();
      } catch {
        /* already gone */
      }
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited.catch(() => {});
      clearTimeout(timer);
    },
  };
}
