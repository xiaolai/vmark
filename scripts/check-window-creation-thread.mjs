#!/usr/bin/env node
/**
 * Window-creation threading gate — `pnpm lint:window-thread`, in `check:static`.
 *
 * A `#[tauri::command]` WITHOUT `async` is `ExecutionContext::Blocking`: the
 * generated wrapper runs the body inline on the thread that handed Tauri the
 * IPC message. On Windows that thread is inside WebView2's
 * `add_WebMessageReceived` COM callback (wry `webview2/mod.rs`), and creating a
 * webview from inside a WebView2 callback is the reentrancy case WebView2
 * forbids. Both upstreams say so in their own source:
 *
 *   tauri `WebviewWindowBuilder::new` — "On Windows, this function deadlocks
 *     when used in a synchronous command and event handlers … You should use
 *     `async` commands and separate threads when creating windows."
 *   tauri-runtime-wry `create_webview` — "this must be called from a separate
 *     thread, otherwise the channel will introduce a deadlock."
 *
 * This is a WINDOWS-ONLY hang with NO macOS symptom, so nothing a maintainer
 * runs locally can see it: it compiles, it passes every other gate, and it
 * ships. #1301 and #1302 are that failure — the Settings window opened from
 * the status bar (a frontend `invoke`) froze the app, while the SAME window
 * opened from the native menu worked, because a menu click arrives through
 * tao's event loop rather than through a WebView2 callback. That asymmetry is
 * the fingerprint of this bug class.
 *
 * The property: every `#[tauri::command]` that can reach
 * `WebviewWindowBuilder::new` must run off the main thread — `async fn`, or
 * `#[tauri::command(async)]` (which spawns even a sync body onto the runtime).
 *
 * Measured at ZERO once #1301 was fixed (7 commands converted), so it ships
 * zero-tolerance with NO baseline. Do not add one: a baseline here would be a
 * list of commands known to hang Windows.
 *
 * WHY REACHABILITY IS VISIBILITY-AWARE. Resolving calls by bare name reports
 * 15 findings on this crate, 8 of them false: the seed set is six private
 * helpers, two of them named `start` and two `start_print`, and those names are
 * written in modules that have nothing to do with windows. Visibility settles it
 * without a name resolver — a private `fn` is callable only from its own module,
 * i.e. its own file. With that one rule the same scan reports 7, all real.
 *
 * ESCAPE HATCH. A command that hands window creation to a spawned task is
 * already off the main thread and is not a defect. Mark it
 * `// window-thread-ok: <reason>` on a line inside the command body. The reason
 * is REQUIRED — a bare marker is rejected, the same rule the i18n allowlist and
 * `command-error-ok` carry.
 *
 * @coordinates-with src-tauri/src/window_manager/ — the window builders
 * @module scripts/check-window-creation-thread
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** The call that actually creates a native window + webview. */
export const WINDOW_BUILDER = "WebviewWindowBuilder::new";
/** Per-command opt-out; the trailing reason is required. */
export const OK_MARKER = /\/\/\s*window-thread-ok:\s*(\S.*)$/m;
const BARE_MARKER = /\/\/\s*window-thread-ok:?\s*$/m;

/**
 * Blank out comments while preserving byte offsets and newlines.
 *
 * Load-bearing, not tidiness: this file's own header names
 * `WebviewWindowBuilder::new` and `#[tauri::command]` in prose, and so do
 * several Rust module docs. Scanning raw source reads those as code — the
 * mistake `check-ipc-contract.mjs` already records making.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let inStr = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inStr) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === inStr) inStr = null;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = '"'; out += c; i++; continue; }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && c2 === "*") {
      let depth = 1; out += "  "; i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; out += "  "; i += 2; continue; }
        if (src[i] === "*" && src[i + 1] === "/") { depth--; out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Item header + body for every `fn` in one file, with its command attribute. */
export function parseFns(file, rawSrc) {
  const src = stripComments(rawSrc);
  const FN =
    /(?:^|\n)[ \t]*((?:pub(?:\s*\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z0-9_]+))/g;
  const out = [];
  let m;
  while ((m = FN.exec(src))) {
    const header = m[1];
    const name = m[2];
    const start = m.index + m[0].indexOf(header);
    const open = src.indexOf("{", start);
    if (open < 0) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    const body = src.slice(open, i + 1);
    // Only further attributes may sit between the marker and the `fn`, so the
    // lookbehind window is deliberately small: a wide one is what lets a scan
    // bind an attribute to an unrelated function.
    const before = src.slice(Math.max(0, start - 600), start);
    const attr = before.match(/#\[(?:tauri::)?command\b([^\]]*)\][\s]*(?:#\[[^\]]*\][\s]*)*$/);
    const vis = header.match(/^pub(?:\s*\(([^)]*)\))?\s+/);
    const { line } = { line: rawSrc.slice(0, start).split("\n").length };
    out.push({
      file,
      name,
      line,
      body,
      // The RAW slice keeps comments, so the opt-out marker survives stripping.
      rawBody: rawSrc.slice(open, i + 1),
      isAsync: /\basync\s+fn\b/.test(header),
      isCommand: !!attr,
      attrArgs: attr ? attr[1] : "",
      /** Callable from another module — private fns are file-scoped. */
      crateVisible: !!vis && (vis[1] === undefined || /crate|super|in\s+/.test(vis[1])),
      id: `${file}::${name}`,
    });
  }
  return out;
}

/** Ids of every fn that can reach `WebviewWindowBuilder::new`, transitively. */
export function reachableWindowCreators(fns) {
  const reach = new Set(fns.filter((f) => f.body.includes(WINDOW_BUILDER)).map((f) => f.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const caller of fns) {
      if (reach.has(caller.id)) continue;
      for (const callee of fns) {
        if (!reach.has(callee.id)) continue;
        // A private callee is only visible inside its own module (= its file).
        if (!callee.crateVisible && callee.file !== caller.file) continue;
        const call = new RegExp(`\\b${callee.name}\\s*(?:::\\s*<[^>]*>\\s*)?\\(`);
        if (call.test(caller.body)) { reach.add(caller.id); changed = true; break; }
      }
    }
  }
  return reach;
}

/** Commands that create a window on the main thread, plus bare-marker abuses. */
export function findings(fns) {
  const reach = reachableWindowCreators(fns);
  const violations = [];
  const bareMarkers = [];
  for (const fn of fns) {
    if (BARE_MARKER.test(fn.rawBody) && !OK_MARKER.test(fn.rawBody)) bareMarkers.push(fn);
    if (!fn.isCommand || !reach.has(fn.id)) continue;
    if (fn.isAsync || /\basync\b/.test(fn.attrArgs)) continue;
    if (OK_MARKER.test(fn.rawBody)) continue;
    violations.push(fn);
  }
  return { violations, bareMarkers, seedCount: fns.filter((f) => f.body.includes(WINDOW_BUILDER)).length };
}

function main() {
  // A missing `src-tauri/src` makes `find` exit non-zero. Swallowing that into
  // an empty list is safe ONLY because the empty case below is a hard failure —
  // never a pass. Letting the exception escape would exit 1 with a stack trace,
  // which reads as a finding rather than as a broken gate.
  let found = "";
  try {
    found = execFileSync("find", ["src-tauri/src", "-type", "f", "-name", "*.rs"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    found = "";
  }
  const files = found
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((f) => !/\.test\.rs$/.test(f));

  if (files.length === 0) {
    console.error("no Rust sources found under src-tauri/src — refusing to pass vacuously");
    process.exit(64);
  }

  const fns = files.flatMap((f) => parseFns(f, readFileSync(f, "utf8")));
  const { violations, bareMarkers, seedCount } = findings(fns);

  if (seedCount === 0) {
    console.error(
      `no function calls ${WINDOW_BUILDER} — the window-creation primitive moved; update this gate`,
    );
    process.exit(64);
  }

  if (bareMarkers.length) {
    console.error("window-thread-ok markers with no reason (a reason is required):\n");
    for (const f of bareMarkers) console.error(`  ${f.file}:${f.line}  ${f.name}`);
    process.exit(1);
  }

  if (violations.length) {
    console.error(
      "Tauri commands that create a window on the main thread (deadlocks on Windows):\n",
    );
    for (const f of violations) console.error(`  ${f.file}:${f.line}  ${f.name}`);
    console.error(
      "\nMake each one `#[tauri::command(async)]` (or `async fn`) so the body runs off\n" +
        "the main thread. See the header of scripts/check-window-creation-thread.mjs.",
    );
    process.exit(1);
  }

  console.log(
    `window-creation threading: OK (${seedCount} builder site(s), every reaching command is async)`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
