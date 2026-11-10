/**
 * The Rust half of the CommandError ratchet: which `#[tauri::command]` fns
 * still return `Result<_, String>`, and which return `CommandError`.
 *
 * Purpose: count the legacy signatures per crate file (the ratchet's numbers)
 * and name the typed commands (what the frontend check guards), from ONE crate
 * walk over lexed CODE — comments and string literals never count.
 *
 * Key decisions: the attribute is matched with balanced arguments, the return
 * type with its path normalised, and type aliases are resolved crate-wide —
 * the gate entry file's header gives the reason for each.
 *
 * @coordinates-with scripts/check-command-error-ratchet.mjs — the gate CLI that re-exports this
 * @coordinates-with scripts/lib/rustSource.mjs — the one Rust lexer
 * @module scripts/lib/commandErrorRatchet/rustCommands
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

import { rustCode } from "../rustSource.mjs";

const SCAN_ROOT = ["src-tauri", "src"];
/** `#[tauri::command` OR the imported `#[command` (`use tauri::command;` —
 *  17 sites in this crate, e.g. mcp_bridge/control.rs, genies/commands.rs), tolerating
 *  the whitespace rustfmt would never write but the language allows. The IPC
 *  contract gate matches both forms for the same reason; matching only the
 *  qualified one left three legacy `Result<_, String>` commands invisible to
 *  this ratchet. `\b` stops it matching
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
 * dropped by `typedCommandNames`. A fixed-distance cutoff is
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
    // invisible to the ratchet.
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
 * crate contains. It is also where the alias set has to be
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
