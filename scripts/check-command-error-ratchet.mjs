#!/usr/bin/env node
/**
 * `Result<T, String>` command ratchet (WI-14).
 *
 * Rule 50 §10 used to canonize `Result<T, String>` for every Tauri command, so
 * the only thing that crossed the IPC boundary was prose. The frontend then
 * recovered the failure class by matching TEXT — a `"PARENT_MISSING:"` prefix
 * in the save path, `String(error).includes("APPROVAL_REQUIRED")` in the MCP
 * browser handlers — and ~370 raw-English `format!` sites stayed invisible to
 * `lint:i18n`. `CommandError` (`src-tauri/src/command_error.rs`) replaces it.
 *
 * A crate-wide migration lands over many PRs, and the C1 lesson is that one
 * without a ratchet stalls at "some of it". So: a per-file count of the
 * remaining legacy signatures, frozen at today's reality, two-way (house
 * standard) — a NEW legacy command fails the gate, and a file that improved
 * fails until the win is written down, because an unrecorded win is silent
 * headroom for the next regression.
 *
 * Counting is a real Rust lex, not a regex over raw text: comments and string
 * literals must not count (the baseline would be unfalsifiable), and a plain
 * `fn` returning `Result<T, String>` must not count (ordinary Rust is not this
 * gate's business).
 *
 * The lex is `scripts/lib/rustSource.mjs`'s, not a second copy. This file
 * carried its own `stripCommentsAndStrings`, and it had already DRIFTED from
 * the shared one in both directions a duplicated lexer drifts: it capped
 * raw-string delimiter detection at a 16-character slice (Rust allows 255
 * hashes, so a longer one was mis-tokenised as code — audit R2 #18/#192) and
 * it had never heard of the C string literals `c"…"` / `cr#"…"#` stable since
 * Rust 1.77. Two lexers over one language is the defect; there is one now.
 *
 * The attribute is matched with BALANCED arguments, not as the exact string
 * `#[tauri::command]`: `#[tauri::command(rename_all = "snake_case")]` and
 * `#[tauri::command(async)]` are the same attribute, and an exact-string match
 * made every parameterized command invisible to the ratchet.
 *
 * The return type is matched with its PATH NORMALIZED, so
 * `std::result::Result<_, String>` and `Result<_, ::std::string::String>` count
 * exactly as the bare spelling does.
 *
 * TYPE ALIASES ARE RESOLVED, crate-wide. `type CmdResult<T> = Result<T,
 * String>;` followed by `-> CmdResult<u8>` used to be a legacy signature this
 * gate could not see, and the header said so — which made the documented
 * limitation a documented BYPASS: adding one alias would have taken every
 * future legacy command off the ratchet's books while it reported green. Full
 * name resolution needs `syn`; naming the aliases does not. Every `type X<…> =
 * …;` in the crate is collected and the set that expands (transitively) to
 * `Result<_, String>` counts exactly as the bare spelling does. Measured at
 * zero aliases today, so nothing about the current count changes — the point
 * is that introducing one now fails the gate instead of silencing it.
 *
 * Usage:
 *   node scripts/check-command-error-ratchet.mjs [--root <dir>] [--baseline <file>]
 *   node scripts/check-command-error-ratchet.mjs --write-baseline
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

import { rustCode } from "./lib/rustSource.mjs";

// ─── Pure, testable core ───

const SCAN_ROOT = ["src-tauri", "src"];
/** `#[tauri::command` OR the imported `#[command` (`use tauri::command;` —
 *  17 sites in this crate, e.g. mcp_server.rs, genies/commands.rs), tolerating
 *  the whitespace rustfmt would never write but the language allows. The IPC
 *  contract gate matches both forms for the same reason; matching only the
 *  qualified one left three legacy `Result<_, String>` commands invisible to
 *  this ratchet (audit-fix 2026-09-07). `\b` stops it matching
 *  `#[tauri::command_bogus]` / `#[command_bogus]`. */
const COMMAND_ATTRIBUTE_START = /#\[\s*(?:tauri\s*::\s*)?command\b/g;

/** Split `A, B` at depth 0 of `<>`/`()`/`[]`. */
function splitGenericArgs(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The `fn` beginning at or after `from`: `{ name, returnType }`, where
 * `returnType` is `""` for a fn declaring none, or null when no named `fn`
 * follows at all. Reads to the body brace at depth 0, so a multi-line
 * signature and a generic `Ok` type are both fine.
 *
 * ONE scan answers both questions. The NAME used to be re-found by a second
 * regex over a fixed 400-character slice of the same text, while the return
 * type was found by scanning without any cap — so one declaration had two
 * answers, and a command carrying enough attributes between
 * `#[tauri::command]` and its `fn` was counted by `countLegacyCommands` and
 * dropped by `typedCommandNames` (audit R2 #20). A fixed-distance cutoff is
 * the defect; there is no cutoff now.
 */
function declAfter(text, from) {
  const fn = /\bfn\s+([A-Za-z_]\w*)/.exec(text.slice(from));
  if (!fn) return null;
  const name = fn[1];
  let i = from + fn.index + fn[0].length;
  let depth = 0;
  let arrow = -1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && ch === "-" && text[i + 1] === ">") {
      arrow = i + 2;
      break;
    } else if (depth === 0 && (ch === "{" || ch === ";")) return { name, returnType: "" };
  }
  if (arrow === -1) return null;
  let angle = 0;
  const identChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  for (let j = arrow; j < text.length; j++) {
    const ch = text[j];
    if (ch === "<") angle++;
    else if (ch === ">") angle--;
    else if (angle === 0 && (ch === "{" || ch === ";")) return { name, returnType: text.slice(arrow, j).trim() };
    // A `where` clause is not part of the return TYPE. Swallowing it produced
    // `"Result<T, String> where T: Clone"`, which no longer ends in `>`, so
    // `isLegacyStringResult` did not match and the legacy signature was
    // invisible to the ratchet (audit R2 #19).
    else if (angle === 0 && ch === "w" && text.startsWith("where", j) && !identChar(text[j - 1]) && !identChar(text[j + 5])) {
      return { name, returnType: text.slice(arrow, j).trim() };
    }
  }
  return null;
}

/** Drop a leading `::a::b::` path so `std::result::Result` reads as `Result`
 *  and `::std::string::String` reads as `String`. Generic args are untouched. */
function unqualify(type) {
  return type.replace(/^(?:::)?(?:[A-Za-z_]\w*\s*::\s*)+/, "");
}

const NO_ALIASES = new Set();

/** True when a return type is `Result<_, String>` — the legacy shape, in any
 *  path spelling (`std::result::Result<_, ::std::string::String>` counts), or
 *  the name of an `aliases` member (`CmdResult<u8>`; see `legacyResultAliases`). */
export function isLegacyStringResult(returnType, aliases = NO_ALIASES) {
  const type = unqualify((returnType ?? "").trim());
  if (aliases.size > 0) {
    const head = /^([A-Za-z_]\w*)\s*(?:<[\s\S]*>)?$/.exec(type);
    if (head && aliases.has(head[1])) return true;
  }
  const match = /^Result\s*<([\s\S]*)>$/.exec(type);
  if (!match) return false;
  const args = splitGenericArgs(match[1]);
  return args.length === 2 && unqualify(args[1]) === "String";
}

/**
 * `type Name<…> = <rhs>;` declarations in one file's CODE, as `name -> rhs`.
 *
 * A default type parameter (`type X<T = u8> = …`) is not matched and so is not
 * collected — the same blindness as before this existed, never a new one.
 */
export function typeAliases(text) {
  const out = new Map();
  for (const m of text.matchAll(/\btype\s+([A-Za-z_]\w*)\s*(?:<[^=;{}]*>)?\s*=\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/**
 * Alias names that expand to `Result<_, String>`, over the CODE of every file
 * in the crate — `type CmdResult<T> = Result<T, String>;` and any chain of
 * aliases ending there (`type A<T> = Result<T, String>; type B<T> = A<T>;`).
 *
 * Crate-wide rather than per-file because an alias is normally declared once,
 * in an error module, and used everywhere else. Resolution is a fixpoint, so
 * declaration order does not matter.
 */
export function legacyResultAliases(codeTexts) {
  const declared = new Map();
  for (const text of codeTexts) for (const [name, rhs] of typeAliases(text)) declared.set(name, rhs);
  const legacy = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, rhs] of declared) {
      if (legacy.has(name)) continue;
      if (isLegacyStringResult(rhs, legacy)) {
        legacy.add(name);
        grew = true;
      }
    }
  }
  return legacy;
}

/**
 * Byte offsets just past each `#[tauri::command…]` attribute, with balanced
 * `(...)` arguments consumed so `#[tauri::command(rename_all = "snake_case")]`
 * is the same attribute as the bare form. An attribute whose shape is not
 * understood still yields a position (fail closed — the fn after it is then
 * examined), rather than being dropped.
 */
export function commandAttributeEnds(text) {
  const ends = [];
  COMMAND_ATTRIBUTE_START.lastIndex = 0;
  let match;
  while ((match = COMMAND_ATTRIBUTE_START.exec(text)) !== null) {
    let i = match.index + match[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "(") {
      let depth = 0;
      for (; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) {
          i++;
          break;
        }
      }
      while (i < text.length && /\s/.test(text[i])) i++;
    }
    ends.push(text[i] === "]" ? i + 1 : i);
  }
  return ends;
}

/** Count `#[tauri::command]` fns returning `Result<_, String>` in one file's CODE. */
function countLegacyIn(text, aliases) {
  let count = 0;
  for (const at of commandAttributeEnds(text)) {
    const decl = declAfter(text, at);
    if (decl && isLegacyStringResult(decl.returnType, aliases)) count++;
  }
  return count;
}

/** Count `#[tauri::command]` fns returning `Result<_, String>` in one file. */
export function countLegacyCommands(source, aliases = NO_ALIASES) {
  return countLegacyIn(rustCode(source), aliases);
}

/** Names of `#[tauri::command]` fns whose error type is `CommandError`, from CODE. */
function typedCommandNamesIn(text) {
  const names = [];
  for (const at of commandAttributeEnds(text)) {
    const decl = declAfter(text, at);
    if (!decl) continue;
    const match = /^Result\s*<([\s\S]*)>$/.exec(unqualify(decl.returnType.trim()));
    if (!match) continue;
    const args = splitGenericArgs(match[1]);
    if (args.length !== 2 || unqualify(args[1]) !== "CommandError") continue;
    names.push(decl.name);
  }
  return names;
}

/** Names of `#[tauri::command]` fns whose error type is `CommandError`. */
export function typedCommandNames(source) {
  return typedCommandNamesIn(rustCode(source));
}

/**
 * Files that invoke a TYPED command and render its rejection with `String(...)`
 * or `errorMessage(...)` instead of `commandErrorMessage(...)`.
 *
 * **Parsed, not lexed.** Three rounds of hand-rolled scanning each shipped a
 * fresh false negative — nested, parenthesised, object and function generic
 * arguments; a `}` inside a string closing a catch block early;
 * `.catch(async (e) => …)`; a shadowing inner parameter. The MECHANISM was the
 * defect, so this walks a real TypeScript AST, the way `check-mock-boundaries`,
 * `check-shell-slots` and `check-hooks-react-purity` already do. Scope and
 * string contents then come from the parser instead of from another regex.
 *
 * Deliberately SILENT for files that only invoke LEGACY commands: `String(e)`
 * is CORRECT while the command still returns `Result<T, String>`, and flagging
 * it would demand a change that is wrong until the conversion lands.
 */
export function findStringifiedTypedErrors(files, typedCommands) {
  const hits = [];
  for (const { path: file, source } of files) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));

    // Command names are not always literals: `restartWithHotExit.ts` invokes
    // `HOT_EXIT_COMMANDS.CAPTURE` from a `const … as const` map, and requiring a
    // literal left the gate blind to a LIVE [object Object] defect there. Bind
    // simple compile-time constants — a `const X = "cmd"` and the properties of
    // a `const M = { K: "cmd" }` — which is how every such call in this repo is
    // written. Anything less tractable stays unresolved rather than guessed.
    // ONLY `const` declarations, and only names declared ONCE in the file.
    // Collecting `let`/`var` too meant a reassigned binding resolved to its
    // initializer, and a file-global map meant two same-named consts in
    // different scopes resolved to whichever was visited last — a guessed
    // command name either enables this gate on the wrong file or attributes a
    // finding to a command the file never invokes (audit R2 #22). An ambiguous
    // name is left UNRESOLVED rather than guessed.
    const constStrings = new Map();
    const ambiguous = new Set();
    const record = (key, value) => {
      if (constStrings.has(key) && constStrings.get(key) !== value) ambiguous.add(key);
      constStrings.set(key, value);
    };
    const collectConsts = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isIdentifier(node.name) &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        const init = node.initializer;
        if (ts.isStringLiteralLike(init)) {
          record(node.name.text, init.text);
        } else if (ts.isAsExpression(init) || ts.isObjectLiteralExpression(init)) {
          const obj = ts.isAsExpression(init) ? init.expression : init;
          if (ts.isObjectLiteralExpression(obj)) {
            for (const prop of obj.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) &&
                ts.isStringLiteralLike(prop.initializer)
              ) {
                record(`${node.name.text}.${prop.name.text}`, prop.initializer.text);
              }
            }
          }
        }
      }
      ts.forEachChild(node, collectConsts);
    };
    collectConsts(sf);
    for (const key of ambiguous) constStrings.delete(key);

    /** The command name an argument denotes, or null when it cannot be resolved. */
    const commandNameOf = (arg) => {
      if (!arg) return null;
      if (ts.isStringLiteralLike(arg)) return arg.text;
      if (ts.isIdentifier(arg)) return constStrings.get(arg.text) ?? null;
      if (ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression)) {
        return constStrings.get(`${arg.expression.text}.${arg.name.text}`) ?? null;
      }
      return null;
    };

    let command = null;
    const findInvoke = (node) => {
      if (command !== null) return;
      if (ts.isCallExpression(node)) {
        // Tauri's `invoke` is imported and called as a BARE identifier
        // (`@tauri-apps/api/core`). Accepting `x.invoke(...)` made any method
        // of that name the IPC entry point — `src/test/statefulFsFake.ts`
        // exposes exactly one — so an unrelated call could arm this gate on a
        // file that invokes no command at all (audit R2 #24).
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : null;
        if (name === "invoke") {
          const resolved = commandNameOf(node.arguments[0]);
          if (resolved !== null && typedCommands.has(resolved)) command = resolved;
        }
      }
      ts.forEachChild(node, findInvoke);
    };
    findInvoke(sf);
    if (command === null) continue;

    // A `// command-error-ok: <reason>` marker suppresses only the site it
    // precedes, not the whole file. The reason is required — a bare marker is a
    // mute button, the same rule the i18n allowlist and caret-only marker carry.
    const markers = new Set();
    source.split("\n").forEach((line, i) => {
      if (/\/\/[^\S\n]*command-error-ok:[^\S\n]*\S/.test(line)) markers.add(i);
      else if (/^\s*\/\/\s*\S/.test(line) && markers.has(i - 1)) markers.add(i);
    });

    let found = null;
    // Callbacks whose own parameter IS the caught binding — they must not be
    // treated as shadowing themselves.
    const bindingCallbacks = new WeakSet();
    const walkNode = (node, bound) => {
      if (found) return;
      let next = bound;

      if (ts.isCatchClause(node) && node.variableDeclaration) {
        const nameNode = node.variableDeclaration.name;
        if (ts.isIdentifier(nameNode)) next = new Set(bound).add(nameNode.text);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        // A promise binds its rejection in two places, not one: `.catch(cb)`
        // and `.then(onFulfilled, onRejected)`. Only the first was recognised,
        // so a two-argument `.then` stringified a typed CommandError with the
        // gate silent — a false NEGATIVE, the direction that matters here
        // (audit R2 #25).
        const method = node.expression.name.text;
        const cb =
          method === "catch" ? node.arguments[0] : method === "then" ? node.arguments[1] : undefined;
        if (
          cb &&
          (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
          cb.parameters[0] &&
          ts.isIdentifier(cb.parameters[0].name)
        ) {
          next = new Set(bound).add(cb.parameters[0].name.text);
          bindingCallbacks.add(cb);
        }
      }

      if (
        bound.size > 0 &&
        !bindingCallbacks.has(node) &&
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node))
      ) {
        // An inner parameter of the same name SHADOWS the caught binding.
        const shadowed = node.parameters
          .map((param) => param.name)
          .filter((n) => ts.isIdentifier(n) && next.has(n.text));
        if (shadowed.length > 0) {
          next = new Set(next);
          for (const n of shadowed) next.delete(n.text);
        }
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const fn = node.expression.text;
        const arg = node.arguments[0];
        if (
          (fn === "String" || fn === "errorMessage") &&
          node.arguments.length === 1 &&
          arg &&
          ts.isIdentifier(arg) &&
          next.has(arg.text)
        ) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
          if (!markers.has(line) && !markers.has(line - 1)) {
            found = { file, command, line: line + 1 };
          }
        }
      }

      ts.forEachChild(node, (child) => walkNode(child, next));
    };
    walkNode(sf, new Set());
    if (found) hits.push(found);
  }
  return hits;
}

/**
 * JSX must be parsed as JSX, or `<Foo/>` is a syntax error and the file is
 * skipped; TypeScript must be parsed as TypeScript, or a type annotation is.
 *
 * Switched on the actual EXTENSION. The substring test this replaced asked
 * whether the path `includes(".ts")`, which is false for `foo.mts` and
 * `foo.cts` — both of which `FRONTEND_SOURCE` scans — so every ESM/CJS
 * TypeScript module in `src/` was handed to the parser as JavaScript, and a
 * stringified typed error inside one was invisible (audit R2 #26).
 */
function scriptKindFor(file) {
  const ext = /\.([cm]?[jt]sx?)$/.exec(file)?.[1];
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return ts.ScriptKind.TS;
    case "tsx":
    case "mtsx":
    case "ctsx":
      return ts.ScriptKind.TSX;
    case "jsx":
    case "mjsx":
    case "cjsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

function walk(dir, rootLen, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, rootLen, out);
    // `*.test.rs` is the crate's test-module convention (`#[path]`-included);
    // a fixture command there is not part of the shipped IPC surface.
    else if (entry.name.endsWith(".rs") && !entry.name.endsWith(".test.rs")) {
      out.push(full.slice(rootLen).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * ONE crate walk: `{ counts, typed }` — the per-file legacy counts (count > 0)
 * and every typed command name.
 *
 * The crate used to be walked, read and lexed TWICE, once per question, which
 * is the same work done twice and — since the two passes are what feed the two
 * halves of this gate — two chances for them to disagree about which files the
 * crate contains (audit R2 #27). It is also where the alias set has to be
 * built: an alias is declared once and used elsewhere, so nothing per-file can
 * see it.
 */
export function scanCrate(root) {
  const scanDir = path.join(root, ...SCAN_ROOT);
  if (!existsSync(scanDir)) return { counts: {}, typed: new Set() };
  const files = walk(scanDir, root.length + 1, [])
    .sort()
    .map((rel) => ({ rel, code: rustCode(readFileSync(path.join(root, rel), "utf8")) }));
  const aliases = legacyResultAliases(files.map((f) => f.code));
  const counts = {};
  const typed = new Set();
  for (const { rel, code } of files) {
    const count = countLegacyIn(code, aliases);
    if (count > 0) counts[rel] = count;
    for (const name of typedCommandNamesIn(code)) typed.add(name);
  }
  return { counts, typed };
}

/**
 * Every production JS/TS extension, not just `.ts`/`.tsx`:
 * `src/export/reader/vmark-reader.js` is real production source and a defect
 * there was invisible to this gate. `.spec.` is excluded alongside `.test.`.
 */
const FRONTEND_SOURCE = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;
const FRONTEND_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Frontend sources that could receive a command rejection (tests excluded). */
function walkFrontend(dir, rootLen, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "locales") continue;
      walkFrontend(full, rootLen, out);
    } else if (FRONTEND_SOURCE.test(entry.name) && !FRONTEND_TEST.test(entry.name)) {
      out.push(full.slice(rootLen).split(path.sep).join("/"));
    }
  }
  return out;
}

/** The frontend files that stringify one of `typed`'s command rejections. */
export function scanStringifiedTypedErrors(root, typed) {
  if (typed.size === 0) return [];
  const files = walkFrontend(path.join(root, "src"), root.length + 1, []).map((rel) => ({
    path: rel,
    source: readFileSync(path.join(root, rel), "utf8"),
  }));
  return findStringifiedTypedErrors(files, typed);
}

/** Fail loudly on malformed baseline data — never read a bad file as "empty". */
export function validateBaseline(raw, label) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label}: expected a JSON object with a "files" map`);
  }
  const files = raw.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new Error(`${label}: "files" must be an object of {path: count}`);
  }
  for (const [file, count] of Object.entries(files)) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(
        `${label}: count for ${file} must be a positive integer, got ${JSON.stringify(count)}`,
      );
    }
  }
  return files;
}

/** Two-way per-file comparison. */
export function compareCounts(actual, baseline) {
  const raised = [];
  const lowered = [];
  const gone = [];
  for (const [file, count] of Object.entries(actual)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) raised.push({ file, count, allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = actual[file];
    if (count === undefined) gone.push({ file, allowed });
    else if (count < allowed) lowered.push({ file, count, allowed });
  }
  return { raised, lowered, gone };
}

// ─── CLI shell ───

const BASELINE_HEADER = [
  "Remaining `Result<T, String>` #[tauri::command] signatures per file — the WI-14 CommandError migration ratchet.",
  "Checked by scripts/check-command-error-ratchet.mjs (pnpm lint:command-errors, in check:all).",
  "Two-way: a NEW legacy signature fails the gate, and a file that improved fails until its number is lowered here — an unrecorded win is silent headroom for the next regression.",
  "Numbers only go DOWN. Migrate the command to Result<T, CommandError> (see .claude/rules/50-codebase-conventions.md §10), then lower or delete its entry.",
  "Registered in the WI-16 ratchet manifest (scripts/check-baseline-ratchet.mjs), which re-compares this file against the merge base in CI — so a commit cannot raise its own floor.",
];

/**
 * Parse argv, or throw with the message to print.
 *
 * A value-taking flag MUST be followed by a value. `--root` with nothing after
 * it read `argv[++i]` as `undefined` and then fell through to `args.root ??
 * <default>` — so a mistyped invocation silently scanned the repository the
 * script lives in rather than the tree the caller named, and reported a verdict
 * about the wrong tree (audit R2 #28). A following `--flag` is the same
 * mistake spelled differently, so it is refused too.
 */
export function parseArgs(argv) {
  const args = { root: null, baseline: null, write: false };
  const value = (flag, i) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${flag} needs a value (got ${next === undefined ? "nothing" : JSON.stringify(next)})`);
    }
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = value("--root", i++);
    else if (argv[i] === "--baseline") args.baseline = value("--baseline", i++);
    else if (argv[i] === "--write-baseline") args.write = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.error(
      "   Usage: node scripts/check-command-error-ratchet.mjs [--root <dir>] [--baseline <file>] [--write-baseline]",
    );
    process.exit(1);
  }
  const root = path.resolve(
    args.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const baselinePath = path.resolve(
    args.baseline ?? path.join(root, "scripts", "command-error-baseline.json"),
  );

  const { counts: actual, typed } = scanCrate(root);
  const total = Object.values(actual).reduce((sum, n) => sum + n, 0);

  if (args.write) {
    writeFileSync(
      baselinePath,
      JSON.stringify({ "//": BASELINE_HEADER, files: actual }, null, 2) + "\n",
    );
    console.log(`✍️  Wrote ${total} remaining legacy command(s) to ${baselinePath}`);
    return;
  }

  let baseline;
  try {
    baseline = validateBaseline(JSON.parse(readFileSync(baselinePath, "utf8")), baselinePath);
  } catch (error) {
    console.error(`❌ Cannot read the command-error baseline (${baselinePath}): ${error.message}`);
    console.error("   The gate fails closed — fix the baseline, never delete it to pass.");
    process.exit(1);
  }

  const { raised, lowered, gone } = compareCounts(actual, baseline);

  const stringified = scanStringifiedTypedErrors(root, typed);

  if (raised.length === 0 && lowered.length === 0 && gone.length === 0 && stringified.length === 0) {
    console.log(
      `✅ CommandError ratchet held (${total} legacy Result<T, String> command(s) remain, none added).`,
    );
    return;
  }

  if (stringified.length > 0) {
    console.error(
      `\n❌ ${stringified.length} frontend file(s) render a TYPED command's error with String():\n`,
    );
    for (const { file, command } of stringified) console.error(`   ${file} — invokes ${command}`);
    console.error(
      "\n   A CommandError is a plain object, so String(error) renders the literal\n" +
        '   "[object Object]". Use commandErrorMessage() (rule 50 §10). This shipped\n' +
        "   to users at four boundaries before WI-DP2.6 caught it by hand.",
    );
  }

  if (raised.length > 0) {
    console.error(`\n❌ ${raised.length} file(s) gained a legacy Result<T, String> command:\n`);
    for (const { file, count, allowed } of raised) {
      console.error(`   ${file} — ${count} found, ${allowed} allowed`);
    }
    console.error(
      "\n   New commands return Result<T, CommandError> (rule 50 §10). The frontend\n" +
        "   branches on `code`; a String forces it back to matching message text.",
    );
  }

  if (lowered.length > 0) {
    console.error(`\n❌ ${lowered.length} file(s) improved — record the win:\n`);
    for (const { file, count, allowed } of lowered) {
      console.error(`   ${file} — ${count} found, baseline still says ${allowed}`);
    }
  }

  if (gone.length > 0) {
    console.error(`\n❌ ${gone.length} baselined file(s) no longer have legacy commands:\n`);
    for (const { file, allowed } of gone) console.error(`   ${file} — baseline says ${allowed}`);
    console.error("\n   Delete these entries so the improvement cannot become headroom.");
  }

  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
