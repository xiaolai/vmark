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
 * argument validation and error transformation in `server/mcp/src/tools/
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
 * @coordinates-with server/mcp/src/cli.ts — the process spawned here
 * @coordinates-with server/mcp/src/utils/portFile.ts — how it finds VMark
 * @coordinates-with src-tauri/tauri.dev.conf.json — the dev profile identifier
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createStdioChannel } from "./jsonRpcStdio.mjs";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SIDECAR_DIR = join(REPO_ROOT, "server/mcp");
const SIDECAR_ENTRY = join(SIDECAR_DIR, "dist", "cli.js");

/** MCP protocol version the SDK server in this repo speaks. */
const PROTOCOL_VERSION = "2024-11-05";

/** Outer per-call cap. The sidecar's own bridge request timeout is 25s
 *  (`websocket.ts:64`); this must exceed it so a real bridge timeout surfaces as
 *  the sidecar's error rather than as our own, less informative, one. */
const CALL_TIMEOUT_MS = 40_000;

/**
 * Which app's data directory to look in — DERIVED, never restated.
 *
 * Every per-app path Tauri hands out (app data, logs, the webview's storage) is
 * built from the bundle `identifier`, so the identifier IS the profile. E2E
 * always drives a `tauri dev` build, which means it must look in the DEV
 * profile; defaulting to the release identifier would point this helper at
 * whichever installed VMark happens to be running, and silently drive the
 * user's real app instead of the one under test.
 *
 * Read from `tauri.dev.conf.json` rather than copied out of it: a literal here
 * is a second spelling of the same fact, and the whole defect this replaced was
 * two profiles that were supposed to differ and did not.
 */
function devIdentifier() {
  if (process.env.VMARK_APP_IDENTIFIER) return process.env.VMARK_APP_IDENTIFIER;
  const conf = JSON.parse(
    readFileSync(join(REPO_ROOT, "src-tauri", "tauri.dev.conf.json"), "utf8"),
  );
  if (typeof conf.identifier !== "string" || conf.identifier.length === 0) {
    throw new Error(
      "tauri.dev.conf.json declares no `identifier`, so `tauri dev` shares the " +
        "release app's profile. Restore it — see src/test/devProfileIsolation.test.ts.",
    );
  }
  return conf.identifier;
}

/** VMark's port file — `{port}:{token}`, rewritten on every app launch. */
function portFilePath() {
  const id = devIdentifier();
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", id, "mcp-port");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), id, "mcp-port");
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), id, "mcp-port");
}

/**
 * Parse a `{port}:{token}` port file, or null if it does not name a valid port.
 *
 * Anchored, not `parseInt`: `parseInt("80x", 10)` is 80, so a truncated or
 * half-written file — which is exactly what a concurrent app launch produces —
 * read as a perfectly good port. The run then went on and failed somewhere
 * else, against a port nothing was listening on.
 */
export function parsePortFile(raw) {
  const port = Number(/^(\d{1,5})(?::|$)/.exec(String(raw).trim())?.[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/**
 * Normalize an MCP `tools/call` reply into `{ isError, text, json, content }`.
 *
 * `json` prefers `structuredContent`. The sidecar attaches it deliberately —
 * `staleError.ts` puts `current_revision` there precisely so a caller can
 * branch without parsing a sentence — and reading only `content` threw that
 * away, leaving the one field the protocol guarantees unreachable from a
 * journey. Prose results still fall back to parsing the text.
 */
export function normalizeToolResult(reply) {
  if (reply.error) {
    return { isError: true, text: JSON.stringify(reply.error), json: undefined, content: [] };
  }
  const result = reply.result ?? {};
  const content = result.content ?? [];
  const text = content
    .filter((c) => c?.type === "text")
    .map((c) => c.text)
    .join("\n");
  let json = result.structuredContent;
  if (json === undefined) {
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined; // many results are prose, not JSON
    }
  }
  return { isError: result.isError === true, text, json, content };
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
  // Resolved OUTSIDE the catch. A missing dev identifier is a configuration
  // error, not "the bridge is not up yet" — swallowing it made a misconfigured
  // dev profile silently SKIP coverage-required journeys, reporting the same
  // green as a run that exercised them (audit finding #9). Only the absent
  // port file below is an expected, suppressible condition.
  const path = portFilePath();
  try {
    return parsePortFile(await readFile(path, "utf8")) !== null;
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
  // crash legible instead of appearing as a silent hang. Framing, the pending
  // map, and the refusal to write to a dead process live in `jsonRpcStdio`.
  const channel = createStdioChannel(child, { timeoutMs: CALL_TIMEOUT_MS });

  // Handshake: initialize, then the initialized notification. `tools/call` before
  // this is a protocol error.
  //
  // A failure here USED TO LEAK THE PROCESS: the throw skipped every path that
  // could have reaped the child, so a rejected handshake left an orphaned
  // sidecar holding a bridge connection for the rest of the run — and the next
  // journey then failed for a reason that had nothing to do with it.
  let init;
  try {
    init = await channel.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "vmark-e2e", version: "1.0.0" },
    });
    if (init.error) {
      throw new Error(`MCP initialize failed: ${JSON.stringify(init.error)}`);
    }
  } catch (err) {
    await channel.close();
    const stderr = channel.stderr().trim();
    throw new Error(stderr ? `${err.message}\nstderr:\n${stderr}` : err.message);
  }
  channel.notify("notifications/initialized", {});

  return {
    async listTools() {
      const reply = await channel.send("tools/list", {});
      if (reply.error) throw new Error(`tools/list failed: ${JSON.stringify(reply.error)}`);
      return reply.result?.tools ?? [];
    },

    /**
     * Call a tool and return `{ isError, text, json, content }`.
     *
     * NOTE the shape. `mcpAdapters.ts` returns only `content` + `isError`; the
     * app-side `data.needsApproval` does NOT survive to the MCP boundary — it is
     * rendered into the error TEXT by `toErrorResult`. Journeys must assert on
     * `text`, and treat a successful RETRY as the only proof that authority was
     * actually minted in Rust.
     *
     * `json` prefers `structuredContent` over parsing the prose. The sidecar
     * attaches it deliberately — `staleError.ts` puts `current_revision` there
     * precisely so a caller can branch without parsing a sentence — and reading
     * only `content` threw that away, leaving the one field the protocol
     * guarantees unreachable from a journey.
     */
    async callTool(name, args = {}) {
      return normalizeToolResult(await channel.send("tools/call", { name, arguments: args }));
    },

    stderr: () => channel.stderr(),

    /** stdout lines that were not protocol frames — kept for diagnostics. */
    noise: () => channel.noise(),

    close: () => channel.close(),
  };
}
