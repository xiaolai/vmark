// @vitest-environment node
/**
 * Events the RUST side addresses to one window must only be listened for BY that
 * window — the Rust half of `addressedEventListeners.test.ts` (#1672).
 *
 * `app.emit_to(<window>, event, …)` is delivered to every JS listener whose target
 * is `Any` OR the window, in every webview (`tauri-2.x/src/event/listener.rs`,
 * `match_any_or_filter`). A plain `listen(event, …)` has target `Any`, so each
 * window used to hear (and, for `browser://*`, cache) every other window's events.
 *
 * Two halves, so neither rots alone:
 *  1. The REGISTRY below names each Rust-addressed event, who sends it and which
 *     window it goes to; no registered event may have a global listener without a
 *     window target.
 *  2. A scan of `src-tauri/src` finds every `emit_to(…)` call, resolves its event
 *     name (a literal, or a `const NAME: &str = "…"` anywhere in the tree) and
 *     fails when the event is not in the registry. A new addressed event therefore
 *     cannot ship unregistered; a call whose event is a runtime value is allowed
 *     only in the listed forwarding files.
 *
 * Not covered, on purpose: broadcasts (`app.emit` / `window.emit` reach every
 * listener by design — see EXEMPT) and listener event names built at run time.
 * It exists to catch honest mistakes.
 *
 * @module test/rustAddressedEventListeners.test
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_NATIVE_EVENTS } from "@/services/browser/browserNativeEventDecoder";
import { literal, parse, sources, untargetedListenCalls } from "./eventListenerScan";

/** Every event Rust sends with `emit_to`, and where it goes. */
const REGISTRY: Record<string, { emitter: string; window: string }> = {
  "fs:changed": { emitter: "watcher.rs", window: "the watching window (watch id = label)" },
  "live-docs:request": { emitter: "live_docs.rs", window: "the window asked for its live documents" },
  "mcp-bridge:request": { emitter: "mcp_bridge/live_emit.rs", window: "the window the request routes to" },
  "pdf-export-progress": { emitter: "pdf_export/renderer/progress.rs", window: "the pdf-export window" },
  ...Object.fromEntries(
    BROWSER_NATIVE_EVENTS.map((e) => [e, { emitter: "browser/nav_emit_macos.rs emit_to_owner", window: "the window owning the tab" }]),
  ),
};

/** Sent to everybody on purpose (`app.emit`), so a global listener is correct. */
const EXEMPT: Record<string, string> = {
  "browser://user-input": "app.emit broadcast in user_input_monitor_macos.rs; only the owning window has lease state, the rest no-op",
};

/** Files whose `emit_to` takes the event as a parameter: their callers pass registered events. */
const FORWARDING_FILES = ["browser/nav_emit_macos.rs"];

const RUST_ROOT = "src-tauri/src";

function rustFiles(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rustFiles(path));
    else if (entry.name.endsWith(".rs") && !entry.name.endsWith(".test.rs")) {
      out.push([path.slice(RUST_ROOT.length + 1), readFileSync(path, "utf8")]);
    }
  }
  return out;
}

/** Whole-line `//` comments dropped (a trailing `//` may sit inside a `"browser://…"` string). */
const code = (src: string) => src.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

/** `emit_to(<target>, <event>, …)` events: resolved names, plus files whose event is a runtime value. */
function rustAddressedEvents(files: Array<[string, string]>) {
  const consts = new Map<string, string>();
  for (const [, src] of files) {
    for (const m of code(src).matchAll(/\bconst\s+([A-Z0-9_]+)\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]+)"/g)) consts.set(m[1], m[2]);
  }
  const events = new Map<string, string>(); // event -> file
  const unresolved: Array<[string, string]> = []; // [file, arg]
  for (const [file, src] of files) {
    for (const m of code(src).matchAll(/\bemit_to\(\s*[^,]+,\s*([^,)]+?)\s*[,)]/g)) {
      const arg = m[1];
      const quoted = /^"([^"]+)"$/.exec(arg);
      const resolved = quoted ? quoted[1] : consts.get(arg);
      if (resolved) events.set(resolved, file);
      else unresolved.push([file, arg]);
    }
  }
  return { events, unresolved };
}

describe("Rust-side scanner (so a pass is not vacuous)", () => {
  const scan = (src: string, extra = "") => rustAddressedEvents([["x.rs", src + extra]]);

  it("resolves a literal, a constant and a multi-line call", () => {
    const { events } = scan(
      'const EV: &str = "a:b";\nfn f(){ app.emit_to(label.as_str(), "c:d", &id); app.emit_to(\n  EventTarget::webview_window(l),\n  EV,\n  p); }',
    );
    expect([...events.keys()].sort()).toEqual(["a:b", "c:d"]);
  });

  it("reports a runtime event, ignores comments, broadcasts and look-alike names", () => {
    const { events, unresolved } = scan(
      '// app.emit_to(w, "no:pe", 1)\nfn emit_to_owner(){ app.emit("bro:adcast", 1); app.emit_to(label, event, p); }',
    );
    expect(events.size).toBe(0);
    expect(unresolved).toEqual([["x.rs", "event"]]);
  });
});

describe("events Rust addresses to one window", () => {
  const rust = rustFiles(RUST_ROOT);
  const { events, unresolved } = rustAddressedEvents(rust);
  const ts = sources("src")
    .filter(([, src]) => src.includes("listen"))
    .map(([path, src]) => [path, src, parse(src, path)] as const);

  it("are all in the registry (register a new one, with a window-scoped listener)", () => {
    const missing = [...events.entries()].filter(([e]) => !(e in REGISTRY)).map(([e, f]) => `${e} (emit_to in ${f})`);
    expect(missing, `Rust addresses events the registry does not know:\n${missing.join("\n")}`).toEqual([]);
  });

  it("have no runtime-valued emit_to outside the forwarding files", () => {
    const stray = unresolved.filter(([f]) => !FORWARDING_FILES.includes(f)).map(([f, a]) => `${f}: emit_to(…, ${a})`);
    expect(stray, `An emit_to whose event cannot be resolved; use a literal or const:\n${stray.join("\n")}`).toEqual([]);
  });

  it("registry entries still exist in Rust, and every browser:// event is registered or exempt", () => {
    const all = rust.map(([, src]) => code(src)).join("\n");
    for (const event of Object.keys(REGISTRY)) {
      if (event.startsWith("browser://")) continue; // sent through the forwarder, checked below
      expect(events.has(event), `${event} is registered but no emit_to sends it any more`).toBe(true);
    }
    const literals = new Set([...all.matchAll(/"(browser:\/\/[a-z0-9_-]+)"/g)].map((m) => m[1]));
    for (const event of literals) expect(event in REGISTRY || event in EXEMPT, `${event} is neither registered nor exempt`).toBe(true);
    for (const event of Object.keys(REGISTRY).filter((e) => e.startsWith("browser://"))) {
      expect(literals.has(event), `${event} is registered but never appears in Rust`).toBe(true);
    }
  });

  it("are never listened for without a window target", () => {
    const offenders: string[] = [];
    const names = Object.keys(REGISTRY);
    for (const [path, src, sf] of ts) {
      const mentioned = names.some((n) => new RegExp(`["'\`]${n}["'\`]`).test(src)) || src.includes("BROWSER_NATIVE_EVENTS");
      for (const call of untargetedListenCalls(sf)) {
        const event = literal(call.arguments[0]);
        // A literal names its event; a constant/variable is judged by the file it lives in.
        const hit = event !== null ? names.includes(event) : mentioned;
        if (!hit) continue;
        const line = src.slice(0, call.getStart(sf)).split("\n").length;
        offenders.push(`${path}:${line} listens globally${event ? ` for "${event}"` : " for a non-literal event in a file that handles an addressed event"}`);
      }
    }
    expect(
      offenders,
      `Rust emit_to(<window>, event) reaches a listener with no window target in EVERY window (#1672). ` +
        `Use getCurrentWebviewWindow().listen(…) or { target: { kind: "WebviewWindow", label } }:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("have a listener in the frontend, so the scan is reading the real code", () => {
    for (const event of Object.keys(REGISTRY).filter((e) => !e.startsWith("browser://"))) {
      expect(ts.some(([, src]) => src.includes(`"${event}"`)), `${event} has no frontend listener`).toBe(true);
    }
  });
});
