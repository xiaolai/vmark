/**
 * Test helper — Tauri's real webview IPC scripts, loaded from the pinned crate
 * source, with a scripted backend standing in for Rust: so a test drives the
 * app's real `invoke` through `core.js` (callback ids, the callback table) and
 * `ipc-protocol.js` (the custom-protocol request and its `postMessage`
 * fallback), and can deliver any reply into any callback id, as Rust does.
 *
 * Key decisions:
 *   - The scripts are read from the `tauri` package `cargo metadata` names, at
 *     the version this repository pins. A missing `cargo`, package or script
 *     THROWS: a gates-style test fails rather than skips.
 *   - Templates are filled as the crate fills them (`macos`, `http`, the
 *     `brownfield` pattern, the channel-fetch command); `uid()`'s
 *     `getRandomValues(Uint32Array(1))` is answered from a forced sequence, so
 *     callback ids are deterministic and a reload can reuse them.
 *   - The backend sees every execution (command, raw JSON body, callback and
 *     error ids, transport) and answers it now (`{ ok, body }`), never
 *     (`"hold"`, for `deliver` later), or by executing and then failing the
 *     response-body read (`"bodyFails"`).
 *   - `install` builds a fresh `__TAURI_INTERNALS__` (an empty callback table),
 *     which is what a page reload leaves.
 *
 * @module test/tauriIpcHarness
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { vi } from "vitest";

/** The Tauri crate version whose scripts the harness loads. */
const TAURI_VERSION = "2.12.2";
const SCRIPTS = ["pattern.js", "core.js", "ipc-protocol.js", "ipc.js", "process-ipc-message-fn.js"] as const;
type ScriptName = (typeof SCRIPTS)[number];

/** Read the pinned crate's IPC scripts; throws when `cargo metadata` or a script is unavailable. */
function readTauriScripts(): Record<ScriptName, string> {
  const manifest = resolve(import.meta.dirname, "../../src-tauri/Cargo.toml");
  const raw = execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", manifest], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const meta: unknown = JSON.parse(raw);
  const packages = typeof meta === "object" && meta !== null && "packages" in meta && Array.isArray(meta.packages) ? meta.packages : [];
  const tauri: unknown = packages.find(
    (p: unknown) => typeof p === "object" && p !== null && "name" in p && p.name === "tauri" && "version" in p && p.version === TAURI_VERSION,
  );
  if (typeof tauri !== "object" || tauri === null || !("manifest_path" in tauri) || typeof tauri.manifest_path !== "string") {
    throw new Error(`tauriIpcHarness: cargo metadata names no tauri ${TAURI_VERSION} package`);
  }
  const dir = join(dirname(tauri.manifest_path), "scripts");
  const out = {} as Record<ScriptName, string>;
  for (const name of SCRIPTS) {
    const path = join(dir, name);
    if (!existsSync(path)) throw new Error(`tauriIpcHarness: ${path} is missing`);
    out[name] = readFileSync(path, "utf8");
  }
  return out;
}

/** One command execution the backend saw. */
export interface Execution {
  cmd: string;
  /** The request body exactly as sent: the JSON of the invoke's arguments. */
  body: string;
  callback: number;
  error: number;
  via: "customProtocol" | "postMessage";
}

/** How the backend answers an execution. */
export type Answer = { ok: boolean; body: unknown } | "hold" | "bodyFails";
export type Backend = (execution: Execution) => Answer;

export interface TauriIpcHarness {
  executions: Execution[];
  /** Run a reply into callback `id`, as Rust's response delivery does. */
  deliver(id: number, data: unknown): void;
  /** Reinstall the scripts: a fresh callback table, the id sequence restarted. */
  reload(): void;
}

const fill = (src: string, scripts: Record<ScriptName, string>) =>
  src
    .replaceAll("__TEMPLATE_os_name__", JSON.stringify("macos"))
    .replaceAll("__TEMPLATE_protocol_scheme__", JSON.stringify("http"))
    .replaceAll("__TEMPLATE_invoke_key__", JSON.stringify("harness-invoke-key"))
    .replaceAll("__TEMPLATE_fetch_channel_data_command__", JSON.stringify("plugin:__TAURI_CHANNEL__|fetch"))
    .replaceAll("__TEMPLATE_isolation_origin__", JSON.stringify(""))
    .replaceAll("__TEMPLATE_pattern__", JSON.stringify({ pattern: "brownfield" }))
    .replaceAll("__RAW_process_ipc_message_fn__", scripts["process-ipc-message-fn.js"]);

/** Load Tauri's IPC scripts into this window over `backend`; callback ids come from `ids`. */
export function installTauriIpc(backend: Backend, ids: readonly number[]): TauriIpcHarness {
  const scripts = readTauriScripts();
  const executions: Execution[] = [];
  let next = 0;
  const original = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView<ArrayBuffer>>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1) {
      if (next >= ids.length) throw new Error("tauriIpcHarness: the forced callback ids ran out");
      array[0] = ids[next];
      next += 1;
      return array;
    }
    return original(array);
  });

  const run = (e: Execution) => {
    executions.push(e);
    return backend(e);
  };
  const internals = () => Reflect.get(window, "__TAURI_INTERNALS__") as { runCallback(id: number, data: unknown): void };

  vi.stubGlobal("fetch", async (url: string, init: { body: string; headers: Headers }) => {
    const cmd = decodeURIComponent(new URL(url).pathname.slice(1));
    const callback = Number(init.headers.get("Tauri-Callback"));
    const error = Number(init.headers.get("Tauri-Error"));
    const answer = run({ cmd, body: init.body, callback, error, via: "customProtocol" });
    if (answer === "hold") return new Promise(() => {});
    const headers = new Headers({ "content-type": "application/json" });
    if (answer === "bodyFails") return { headers, json: () => Promise.reject(new TypeError("Load failed")) };
    headers.set("Tauri-Response", answer.ok ? "ok" : "error");
    return { headers, json: async () => answer.body };
  });
  Reflect.set(window, "ipc", {
    postMessage(data: string) {
      const message: unknown = JSON.parse(data);
      if (typeof message !== "object" || message === null || !("cmd" in message) || !("callback" in message) || !("error" in message)) {
        throw new Error("tauriIpcHarness: malformed postMessage");
      }
      const body = JSON.stringify("payload" in message ? message.payload : {});
      const e = { cmd: String(message.cmd), body, callback: Number(message.callback), error: Number(message.error), via: "postMessage" as const };
      const answer = run(e);
      if (answer === "hold" || answer === "bodyFails") return;
      queueMicrotask(() => internals().runCallback(answer.ok ? e.callback : e.error, answer.body));
    },
  });

  const install = () => {
    next = 0;
    Reflect.set(window, "__TAURI_INTERNALS__", {});
    for (const name of ["pattern.js", "core.js", "ipc-protocol.js", "ipc.js"] as const) {
      // Evaluated text: the pinned crate's own scripts with the fixed constants
      // above, which is what the webview runs; nothing here comes from a test input.
      new Function(fill(scripts[name], scripts))();
    }
  };
  install();
  return {
    executions,
    deliver: (id, data) => internals().runCallback(id, data),
    reload: install,
  };
}
