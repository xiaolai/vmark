#!/usr/bin/env node
/**
 * vmark-content-server CLI — the entry VMark's Rust ContentServerManager
 * spawns. A minimal process wrapper: all behavior lives in cliMain.ts
 * (dependency-injected, unit-tested); this file only binds the real process,
 * env, and server.
 *
 * Usage:
 *   vmark-content-server --root <dir> --token <bootstrap> [--port N] [--port-file P]
 *
 * @coordinates-with cliMain.ts — the tested CLI core
 * @module cli
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startKbServer } from "./server/runtime.js";
import { runCli } from "./cliMain.js";

/** Read version from the package manifest (grill L4 — no hardcoded drift point). */
function readVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

runCli(process.argv.slice(2), {
  startServer: startKbServer,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => process.on(signal, handler),
  // unref'd: the watchdog must never be what keeps the process alive.
  setTimer: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  version: readVersion(),
}).catch((err) => {
  // Last resort — runCli handles expected failures itself.
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
