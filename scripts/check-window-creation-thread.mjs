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
 * The property: every `#[tauri::command]` that can reach a window builder —
 * `WebviewWindowBuilder`, `WindowBuilder` or `WebviewBuilder`, via `new` or
 * `from_config`, turbofish and all — must run off the main thread: `async fn`,
 * or `#[tauri::command(async)]` (which spawns even a sync body onto the
 * runtime). A builder imported under an ALIAS is refused rather than missed,
 * because this gate resolves calls by name and cannot follow one.
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

import { rustCode } from "./lib/rustSource.mjs";

/** The call that actually creates a native window + webview. */
export const WINDOW_BUILDER = "WebviewWindowBuilder::new";

/**
 * Every constructor that hands tao/wry a window to create, and therefore every
 * seed for the reachability walk.
 *
 * ONE hardcoded `WebviewWindowBuilder::new` substring was the whole detector,
 * and it fails OPEN in a way `seedCount` cannot see: the existing sites keep
 * the count non-zero, so a NEW site built through `WindowBuilder::new` (a
 * window with no webview), `WebviewBuilder::new` (a webview added to an
 * existing window) or `…::from_config` is simply not a seed, and every command
 * reaching it passes (audit R3 #99). A turbofish between the type and the
 * constructor (`WebviewWindowBuilder::<R>::new`) defeated the substring too.
 *
 * The word boundary matters: `\bWindowBuilder` must not match inside
 * `WebviewWindowBuilder`, or the two names would double-count the same site.
 */
const BUILDER_TYPES = ["WebviewWindowBuilder", "WindowBuilder", "WebviewBuilder"];
const BUILDER_CTORS = ["new", "from_config"];
export const WINDOW_BUILDER_CALL = new RegExp(
  `\\b(?:${BUILDER_TYPES.join("|")})\\s*(?:::\\s*<[^>]*>\\s*)?::\\s*(?:${BUILDER_CTORS.join("|")})\\s*\\(`,
);

/**
 * An ALIAS import of a window builder (`use tauri::WebviewWindowBuilder as W;`).
 *
 * The gate resolves calls by NAME, so it cannot follow one. Rather than fail
 * open on the rename, it refuses: the alias is reported and the gate exits
 * non-zero, which is the loud half of the same property `seedCount` protects.
 */
export const BUILDER_ALIAS = new RegExp(
  `\\b(?:${BUILDER_TYPES.join("|")})\\s+as\\s+([A-Za-z_][A-Za-z0-9_]*)`,
);

/** Per-command opt-out; the trailing reason is required. */
export const OK_MARKER = /\/\/\s*window-thread-ok:\s*(\S.*)$/m;
const BARE_MARKER = /\/\/\s*window-thread-ok:?\s*$/m;

/**
 * Rust source → CODE (`rustCode`), with comments AND every literal blanked but
 * offsets and newlines preserved.
 *
 * Load-bearing, not tidiness: this file's own header names
 * `WebviewWindowBuilder::new` and `#[tauri::command]` in prose, and so do
 * several Rust module docs. Scanning raw source reads those as code — the
 * mistake `check-ipc-contract.mjs` already records making.
 *
 * The literals matter as much as the comments, and the local lexer this
 * replaced kept them: it copied string CONTENTS through, so a `{` inside an
 * ordinary string moved the brace balance, and it knew nothing of raw strings
 * (`r#"…"#`, whose unescaped quotes flipped it in and out of string mode) or
 * char literals (`'{'`). Either could truncate a function body — hiding every
 * call edge after it — or extend one over the next item (audit R2 #104).
 * `lib/rustSource.mjs` is the repo's one Rust lexer and already handles all
 * three, plus NESTED block comments.
 */
export const stripComments = (src) => rustCode(src);
/** Literals blanked, comments KEPT — where the opt-out marker legitimately lives. */
const commentsOnly = (src) => rustCode(src, { keepComments: true });

/**
 * Where the signature that starts at `from` ends: `{` when the fn has a BODY,
 * `;` when it is only a declaration (a trait method, an `extern` block item).
 * Depth-tracked over `(`/`[`, because a `;` is ordinary inside an array type
 * (`fn f(x: [u8; 4])`). Returns `[kind, index]`, or `null` at end of input.
 *
 * `indexOf("{")` did none of this: a bodyless `fn a(&self);` in a trait
 * consumed the NEXT item's body, so a phantom function carried someone else's
 * call edges (audit R2 #103).
 */
function signatureEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (c === "{" || c === ";")) return [c, i];
  }
  return null;
}

/**
 * The contiguous run of outer attributes immediately before `start`, as text.
 *
 * Walks backward: skip whitespace, then match a complete `#[ … ]` group by
 * counting brackets from its `]`, and repeat. Stops at the first token that is
 * not an attribute, so it cannot reach a previous item's attributes — and it
 * cannot be truncated by an arbitrary window either. `src` is CODE (literals
 * blanked), so a `]` inside a string cannot unbalance the count, and an inner
 * attribute (`#![…]`) is rejected by the `#` test.
 */
function attributeBlock(src, start) {
  let i = start;
  for (;;) {
    while (i > 0 && /\s/.test(src[i - 1])) i -= 1;
    if (src[i - 1] !== "]") break;
    let depth = 0;
    let j = i - 1;
    for (; j >= 0; j -= 1) {
      if (src[j] === "]") depth += 1;
      else if (src[j] === "[") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (j < 1 || src[j - 1] !== "#") break;
    i = j - 1;
  }
  return src.slice(i, start);
}

/** Item header + body for every `fn` in one file, with its command attribute. */
export function parseFns(file, rawSrc) {
  const src = stripComments(rawSrc);
  const commented = commentsOnly(rawSrc);
  // `r#name` is the SAME item as `name` — a raw identifier only escapes a
  // keyword — and the bare class stopped at the `r`, naming the function "r"
  // (audit R2 #102).
  const FN =
    /(?:^|\n)[ \t]*((?:pub(?:\s*\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(?:r#)?([A-Za-z0-9_]+))/g;
  const out = [];
  let m;
  while ((m = FN.exec(src))) {
    const header = m[1];
    const name = m[2];
    const start = m.index + m[0].indexOf(header);
    const sig = signatureEnd(src, start + header.length);
    // A declaration with no body (`fn a(&self);`) defines no call edges, and
    // taking the next `{` in the file would give it another item's.
    if (!sig || sig[0] === ";") continue;
    const open = sig[1];
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    const body = src.slice(open, i + 1);
    /** The parameter list, for local-shadowing detection in `callsByName`. */
    const params = src.slice(start + header.length, open);
    // The item's own attribute block, walked BACKWARD over complete `#[…]`
    // groups. It used to be a 600-BYTE slice: a longer contiguous block —
    // several `#[cfg(…)]` lines, or a doc comment blanked to spaces between the
    // attribute and the `fn` — pushed `#[tauri::command]` outside the window,
    // the item stopped being a command, and it left the gate silently
    // (audit R3 #105). Walking the structure has no window to overflow, and it
    // still cannot reach past the first non-attribute token, which is what kept
    // the small window from binding an unrelated function's attribute.
    const before = attributeBlock(src, start);
    const attr = before.match(/#\[(?:tauri::)?command\b([^\]]*)\]/);
    const vis = header.match(/^pub(?:\s*\(([^)]*)\))?\s+/);
    const { line } = { line: rawSrc.slice(0, start).split("\n").length };
    out.push({
      file,
      name,
      line,
      body,
      params,
      // Comments KEPT, literals blanked: the opt-out marker is a comment, and
      // reading it out of raw source let a string containing
      // `// window-thread-ok: …` suppress a real violation (audit R2 #109).
      rawBody: commented.slice(open, i + 1),
      isAsync: /\basync\s+fn\b/.test(header),
      isCommand: !!attr,
      attrArgs: attr ? attr[1] : "",
      /** Callable from another module — private fns are file-scoped. */
      crateVisible: !!vis && (vis[1] === undefined || /crate|super|in\s+/.test(vis[1])),
      // The OFFSET is part of the identity: two `fn start` in one file (two
      // impl blocks, a nested fn) shared `file::name`, so marking one reachable
      // marked the other, and a command calling the innocent one was reported
      // (audit R2 #107).
      id: `${file}::${name}@${start}`,
    });
  }
  return out;
}

/**
 * Does `caller` call `callee`, as far as names can tell?
 *
 * Two forms, and the difference is the second false-positive class this gate
 * has had to answer. Within one FILE any spelling counts: the author can see
 * both definitions, and a local method and a local free function sharing a
 * name is not how this goes wrong. ACROSS files a receiver call — `x.name(`
 * — does not count, because the receiver decides which type's method runs and
 * this scan does not know types. `pdf_export::renderer::sink` gained a
 * `pub(super) fn settle` while `browser::nav_kvo_macos` calls `owned.settle(…)`
 * on something else entirely; with `\b` those two were ONE edge, and through
 * it the reachable set grew to include `read_workspace_config`,
 * `update_recent_files` and five more commands that touch no window at all.
 * Seven findings, every one false, and the "fix" they asked for was making
 * seven unrelated commands async — which `AGENTS.md` records as its own
 * hazard, since going async removes serialization the blocking IPC loop
 * provided.
 *
 * A path-qualified call (`module::name(`, `Type::name(`) still counts across
 * files: `::` is not a receiver. What is given up is a window-creating METHOD
 * reached from another file through a value — none exists here (every builder
 * site is a free function, and `check-window-creation-thread.test.mjs` pins
 * that all seven #1301 commands are still caught by this rule).
 */
/**
 * Does `caller` bind `name` itself — as a parameter, or as a `let`?
 *
 * Either shadows a crate item of the same name for the whole body, so a bare
 * `name(...)` there is the LOCAL callable, not the item.
 */
function bindsLocally(caller, name) {
  const param = new RegExp(`(^|[(,\\s])${name}\\s*:`);
  const binding = new RegExp(`\\blet\\s+(?:mut\\s+)?${name}\\b`);
  return param.test(caller.params) || binding.test(caller.body);
}

function callsByName(caller, callee) {
  if (caller.file === callee.file) {
    return new RegExp(`\\b${callee.name}\\s*(?:::\\s*<[^>]*>\\s*)?\\(`).test(caller.body);
  }
  const qualified = new RegExp(`::\\s*${callee.name}\\s*(?:::\\s*<[^>]*>\\s*)?\\(`);
  // A caller that BINDS the name locally cannot reach the crate item through a
  // bare call — Rust resolves the binding — so only a path-qualified spelling
  // counts. This is the THIRD instance of one class (after bare-name and
  // receiver calls), and it arrived the moment an unrelated refactor gave the
  // crate a `pub(crate) fn register`: `dock_recent.rs`'s `try_register_with`
  // takes a closure PARAMETER called `register` and calls `register(path)`, so
  // the whole dock-recent chain became "reachable" from a window builder and
  // `register_dock_recent` was reported as a Windows deadlock it cannot have.
  // Nothing is given up: a shadowing body that really does mean the crate item
  // has to write `module::name(...)`, which `qualified` still matches.
  if (bindsLocally(caller, callee.name)) return qualified.test(caller.body);
  return new RegExp(`(?<![.\\w])${callee.name}\\s*(?:::\\s*<[^>]*>\\s*)?\\(`).test(caller.body);
}

/** Does this body construct a window? */
export const buildsWindow = (fn) => WINDOW_BUILDER_CALL.test(fn.body);

/** Ids of every fn that can reach a window builder, transitively. */
export function reachableWindowCreators(fns) {
  const reach = new Set(fns.filter(buildsWindow).map((f) => f.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const caller of fns) {
      if (reach.has(caller.id)) continue;
      for (const callee of fns) {
        if (!reach.has(callee.id)) continue;
        // A private callee is only visible inside its own module (= its file).
        if (!callee.crateVisible && callee.file !== caller.file) continue;
        if (callsByName(caller, callee)) { reach.add(caller.id); changed = true; break; }
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
  return { violations, bareMarkers, seedCount: fns.filter(buildsWindow).length };
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

  // An ALIASED builder import renames the very call this gate resolves by name,
  // so it would find nothing and say nothing. Refuse instead of failing open.
  const aliased = [];
  for (const f of files) {
    const m = BUILDER_ALIAS.exec(stripComments(readFileSync(f, "utf8")));
    if (m) aliased.push(`${f}: imported as \`${m[1]}\``);
  }
  if (aliased.length) {
    console.error(
      "a window builder is imported under an ALIAS — this gate resolves calls by name and\n" +
        "cannot follow one, so it would report green while the aliased site went unchecked:\n",
    );
    for (const a of aliased) console.error(`  ${a}`);
    console.error("\nImport the builder under its own name, or teach this gate the alias.");
    process.exit(64);
  }

  const fns = files.flatMap((f) => parseFns(f, readFileSync(f, "utf8")));
  const { violations, bareMarkers, seedCount } = findings(fns);

  if (seedCount === 0) {
    console.error(
      `no function calls ${WINDOW_BUILDER} (nor any other window builder) — the ` +
        "window-creation primitive moved; update this gate",
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
