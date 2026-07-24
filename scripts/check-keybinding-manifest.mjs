#!/usr/bin/env node
/**
 * Keybinding drift gate (WI-1.5 / Phase 8; gap audit #2).
 *
 * A keyboard shortcut with a native menu accelerator lives in FOUR sources that
 * must agree (`.claude/rules/41-keyboard-shortcuts.md`):
 *   1. `src/services/keybinding/keybindingManifest.ts` — the manifest (source of truth)
 *   2. `src/stores/settingsStore/shortcutDefinitions.ts` — frontend defaults
 *   3. `src-tauri/src/menu/localized/*.rs` — the REAL Rust menu builder
 *      (`accel("<menu-id>", "<default-accel>")` call sites), pinned as a contract
 *      mirror in `src-tauri/src/menu/localized.test.rs`
 *      (`DEFAULT_ACCELERATORS` / `PLATFORM_ACCELERATORS`)
 *   4. `website/guide/shortcuts.md` — the human-readable docs table
 *
 * For every manifest entry this gate asserts:
 *   - `defaultKey` / `defaultKeyOther` equal the `shortcutDefinitions.ts` entry,
 *   - the Rust CONTRACT MIRROR accelerator for the entry's `menuId` equals
 *     `prosemirrorToTauri(defaultKey)` (and `prosemirrorToTauri(defaultKeyOther)`
 *     for platform-conditional entries),
 *   - the REAL menu builder's `accel(...)` call site for that `menuId` equals the
 *     same value (closing the "checked against a test mirror, not the real menu"
 *     gap — a drift between the mirror and the real builder is now visible here,
 *     not only in the macOS-only Rust test), and
 *   - the docs table lists the entry's accelerator (order-insensitively; a
 *     menu-backed shortcut must be documented).
 * It also asserts completeness: every `shortcutDefinitions.ts` entry that has a
 * `menuId` (minus the dynamically-bound `search-genies`) must appear in the
 * manifest, and every non-empty accelerator the real menu builder binds must map
 * to a manifest entry (or an explicit allow-listed non-manifest id).
 *
 * Everything is parsed as text (no TS/Rust runtime), so the gate runs under plain
 * `node`. It fails closed: a missing file, unreadable table, or parse error
 * exits non-zero. Run via `pnpm lint:keybinding-manifest` (wired into check:all).
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "src/services/keybinding/keybindingManifest.ts";
const DEFS_PATH = "src/stores/settingsStore/shortcutDefinitions.ts";
const RUST_PATH = "src-tauri/src/menu/localized.test.rs";
const LOCALIZED_DIR = "src-tauri/src/menu/localized";
const DOCS_PATH = "website/guide/shortcuts.md";

/** Menu ids whose accelerator is registered dynamically, not via a static menu accel. */
const DYNAMIC_MENU_IDS = new Set(["search-genies"]);

/**
 * Menu ids that the real menu builder binds a non-empty accelerator to but which
 * are intentionally NOT in the manifest: OS-standard editor commands with no
 * `menuId` entry in `shortcutDefinitions.ts` (not user-customizable). The reverse
 * "real accel with no manifest entry" report allow-lists these.
 */
const NON_MANIFEST_MENU_ACCELS = new Map([
  ["undo", "OS-standard Undo — predefined, not in the customizable shortcut registry"],
  ["redo", "OS-standard Redo — predefined, not in the customizable shortcut registry"],
  ["quit", "OS-standard Quit — predefined, not in the customizable shortcut registry"],
]);

/**
 * Manifest ids whose accelerator is documented only inside a COMPRESSED RANGE in
 * `website/guide/shortcuts.md` ("Heading 1-6 | `Mod + 1` through `Mod + 6`"), so
 * it has no individual accelerator cell. `heading-1` and `heading-6` DO render as
 * individual code spans and are checked normally; only the interior levels are
 * exempt from the docs presence check.
 */
const DOCS_RANGE_DOCUMENTED = new Map([
  ["heading-2", 'documented as the range "Mod + 1 through Mod + 6"'],
  ["heading-3", 'documented as the range "Mod + 1 through Mod + 6"'],
  ["heading-4", 'documented as the range "Mod + 1 through Mod + 6"'],
  ["heading-5", 'documented as the range "Mod + 1 through Mod + 6"'],
]);

/** Read a file or die (fail-closed). */
function readOrDie(rel) {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch (err) {
    fail(`cannot read ${rel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const errors = [];
function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/**
 * Convert ProseMirror key format to Tauri accelerator format.
 * Ported verbatim from `src/stores/settingsStore/keyFormatting.ts`
 * (`prosemirrorToTauri`). Keep in sync if that converter changes — the
 * `settingsShortcuts.test.ts` suite pins the canonical behaviour.
 */
function prosemirrorToTauri(key) {
  if (!key) return "";
  const modifierNames = new Set(["Mod", "Ctrl", "Alt", "Shift"]);
  const modifierMap = { Mod: "CmdOrCtrl" };
  const parts = key.split("-");
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "" && i === parts.length - 1) {
      result.push("-");
    } else if (part === "") {
      continue;
    } else if (modifierNames.has(part) && i < parts.length - 1) {
      result.push(modifierMap[part] ?? part);
    } else {
      const mapped = modifierMap[part] ?? part;
      if (mapped.length === 1 && /[a-z]/i.test(mapped)) {
        result.push(mapped.toUpperCase());
      } else {
        result.push(mapped);
      }
    }
  }
  return result.join("+");
}

/**
 * Read a Rust string literal from `src` starting at index `i` (`src[i]` must be
 * `"`). Mirrors the Rust contract test's `read_string`: a `\\` skips the next
 * char and takes it literally (`\\\\` → `\\`, `\\"` → `"`); a backtick is a plain
 * char. Returns `[content, indexPastClosingQuote]`, failing closed on an
 * unterminated literal.
 */
function readRustString(src, i, rel) {
  i += 1; // skip opening quote
  let out = "";
  while (i < src.length && src[i] !== '"') {
    if (src[i] === "\\") i += 1;
    out += src[i];
    i += 1;
  }
  if (i >= src.length) fail(`${rel}: unterminated Rust string literal while parsing accel(...)`);
  return [out, i + 1];
}

/**
 * Scan every `accel(...)` call site in a real menu-builder source. Ports the
 * paren-depth scanner from `localized.test.rs::scan_accel_calls` so nested
 * `cfg!(...)` parens don't end a call early, and skips line and block comments
 * so a commented-out `accel(...)` never pollutes the parse. Returns an array of
 * `{ id, accel }` where `accel` is either a string (static literal) or
 * `{ mac, other }` (the `if cfg!(target_os = "macos") { … } else { … }` form).
 */
function scanAccelCalls(src, rel) {
  const calls = [];
  let i = 0;
  while (true) {
    const pos = src.indexOf("accel(", i);
    if (pos === -1) break;
    // Require a call boundary: the char before `accel` must not be an identifier
    // char (so `AccelFn`, `my_accel(` etc. never match).
    const prev = pos > 0 ? src[pos - 1] : " ";
    if (/[A-Za-z0-9_]/.test(prev)) {
      i = pos + "accel(".length;
      continue;
    }
    let j = pos + "accel(".length;
    let depth = 1;
    const lits = [];
    while (depth > 0) {
      if (j >= src.length) fail(`${rel}: unterminated accel(...) call — fail closed`);
      const c = src[j];
      const next = src[j + 1];
      if (c === "/" && next === "/") {
        const nl = src.indexOf("\n", j);
        j = nl === -1 ? src.length : nl;
      } else if (c === "/" && next === "*") {
        const end = src.indexOf("*/", j + 2);
        if (end === -1) fail(`${rel}: unterminated block comment inside accel(...)`);
        j = end + 2;
      } else if (c === '"') {
        const [s, nextIdx] = readRustString(src, j, rel);
        lits.push(s);
        j = nextIdx;
      } else if (c === "(") {
        depth += 1;
        j += 1;
      } else if (c === ")") {
        depth -= 1;
        j += 1;
      } else {
        j += 1;
      }
    }
    if (lits.length === 2) {
      calls.push({ id: lits[0], accel: lits[1] });
    } else if (lits.length === 4) {
      if (lits[1] !== "macos") {
        fail(`${rel}: accel("${lits[0]}", …) has an unexpected cfg! target "${lits[1]}" (expected "macos")`);
      }
      calls.push({ id: lits[0], accel: { mac: lits[2], other: lits[3] } });
    } else {
      fail(
        `${rel}: accel(…) call for "${lits[0] ?? "?"}" has ${lits.length} string ` +
          `literals (expected 2 for a static accel or 4 for the macOS/else form). ` +
          `The gate fails closed on any unrecognised accel(...) shape.`,
      );
    }
    i = j;
  }
  return calls;
}

/**
 * Parse every real menu-builder source (`localized/*.rs`, excluding `*.test.rs`)
 * into `{ realDefault, realPlatform, files }`:
 *   - `realDefault: Map<id, accelString>` for static `accel("id", "…")` sites, and
 *   - `realPlatform: Map<id, { mac, other }>` for the platform-conditional form.
 * On a duplicate id (e.g. `preferences`/`quit`/`save-all-quit` appear in both the
 * macOS App menu and the non-macOS File-menu tail) the values MUST agree — a
 * conflict fails the gate.
 */
function parseRealMenu() {
  const realDefault = new Map();
  const realPlatform = new Map();
  let files;
  try {
    files = readdirSync(join(ROOT, LOCALIZED_DIR)).filter(
      (f) => f.endsWith(".rs") && !f.endsWith(".test.rs"),
    );
  } catch (err) {
    fail(`cannot read ${LOCALIZED_DIR}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (files.length === 0) fail(`${LOCALIZED_DIR}: no menu-builder .rs sources found`);
  for (const file of files.sort()) {
    const rel = `${LOCALIZED_DIR}/${file}`;
    const src = readOrDie(rel);
    for (const { id, accel } of scanAccelCalls(src, rel)) {
      if (typeof accel === "string") {
        const prior = realDefault.get(id);
        if (prior !== undefined && prior !== accel) {
          fail(`${rel}: accel("${id}", …) = ${JSON.stringify(accel)} conflicts with an earlier site ${JSON.stringify(prior)}`);
        }
        if (realPlatform.has(id)) {
          fail(`${rel}: "${id}" is a static accel here but platform-conditional elsewhere`);
        }
        realDefault.set(id, accel);
      } else {
        const prior = realPlatform.get(id);
        if (prior !== undefined && (prior.mac !== accel.mac || prior.other !== accel.other)) {
          fail(`${rel}: platform accel("${id}", …) conflicts with an earlier site`);
        }
        if (realDefault.has(id)) {
          fail(`${rel}: "${id}" is platform-conditional here but a static accel elsewhere`);
        }
        realPlatform.set(id, accel);
      }
    }
  }
  if (realDefault.size === 0) fail(`${LOCALIZED_DIR}: parsed zero static accel(...) sites`);
  return { realDefault, realPlatform };
}

// --- Docs (website/guide/shortcuts.md) accelerator extraction ---

const MOD_TOKENS = new Set(["Mod", "Alt", "Ctrl", "Shift", "Cmd", "Option"]);
const GRAVE = "`key"; // canonical token for the backtick key
/** Sentinel that survives fence-stripping, standing in for a backtick KEY. */
const DOC_BT_SENTINEL = "\u0001";
const NAMED_KEYS = new Set([
  "Up", "Down", "Left", "Right", "Enter", "Escape", "Esc", "Tab",
  "Backspace", "Space", "Delete", "Home", "End", "PageUp", "PageDown",
]);

/** Canonicalise one accelerator token (case-fold single letters, unify backtick). */
function canonToken(t) {
  if (t === "`" || t === DOC_BT_SENTINEL) return GRAVE;
  if (t.length === 1 && /[a-z]/i.test(t)) return t.toUpperCase();
  return t;
}

/**
 * Order-insensitive canonical form of an accelerator token list: modifiers are
 * sorted (so `Mod-Alt-]` and the docs' `Alt + Mod + ]` compare equal — the docs
 * legitimately normalise modifier order), then the non-modifier key(s) appended.
 */
function canonAccel(tokens) {
  const canon = tokens.map(canonToken);
  const mods = canon.filter((t) => MOD_TOKENS.has(t)).sort();
  const keys = canon.filter((t) => !MOD_TOKENS.has(t));
  return [...mods, ...keys].join("+");
}

/** ProseMirror key (`Mod-Shift-n`) → raw token list, handling the trailing `-` (minus) key. */
function keyTokens(key) {
  const parts = key.split("-");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "" && i === parts.length - 1) out.push("-");
    else if (p === "") continue;
    else out.push(p);
  }
  return out;
}

/**
 * Human-readable docs accelerator for a ProseMirror key (`Mod-Shift-n` →
 * `Mod + Shift + N`): `-` → ` + `, `Mod` kept verbatim, single letters upper-cased.
 * Used only for error messages; matching goes through `canonAccel` for order
 * tolerance.
 */
function prosemirrorToDocs(key) {
  if (!key) return "";
  return keyTokens(key)
    .map((t) => (t.length === 1 && /[a-z]/i.test(t) ? t.toUpperCase() : t))
    .join(" + ");
}

/** Is `t` a plausible accelerator token (modifier, single key, F-key, or named key)? */
function isAccelToken(t) {
  if (t === DOC_BT_SENTINEL) return true;
  if (MOD_TOKENS.has(t)) return true;
  if (/^F\d{1,2}$/.test(t)) return true;
  if (NAMED_KEYS.has(t)) return true;
  return t.length === 1; // single char: letter, digit, or punctuation key
}

/** Add one docs cell/code-span's accelerator (if it parses as one) to `set`. */
function addDocsAccel(set, cell) {
  const trimmed = cell.replace(/_[^_]*_/g, "").trim(); // drop italic annotations
  if (!trimmed) return;
  const toks = trimmed.includes("+")
    ? trimmed.split("+").map((t) => t.trim()).filter(Boolean)
    : [trimmed];
  if (toks.length === 0 || !toks.every(isAccelToken)) return;
  set.add(canonAccel(toks));
}

/**
 * Build the set of canonical accelerators present in the docs table. Two passes:
 *   1. every inline code span (`` `Mod + 1` ``) — catches range cells that list
 *      several accelerators in one table cell, and
 *   2. every `|`-delimited table cell after fence-stripping — catches un-fenced
 *      accelerators and single-key cells (`` `F4` `` in the F-key reference).
 * The backtick KEY (rendered as the code span `` `` ` `` ``) is swapped for a
 * sentinel first so fence-stripping can't erase it.
 */
function buildDocsAccelSet(raw, rel) {
  const withSentinel = raw.replace(/``\s*`\s*``/g, ` ${DOC_BT_SENTINEL} `);
  const set = new Set();
  for (const m of withSentinel.matchAll(/`([^`\n]+)`/g)) addDocsAccel(set, m[1]);
  const stripped = withSentinel.replace(/`+/g, " ");
  for (const line of stripped.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    for (const cell of line.split("|")) addDocsAccel(set, cell);
  }
  if (set.size === 0) fail(`${rel}: parsed zero accelerators from the docs table`);
  return set;
}

/** Unescape a JS/TS double-quoted string body into its runtime value. */
function unquote(rawBody) {
  return JSON.parse(`"${rawBody}"`);
}

/**
 * Unescape a single-quoted (or backtick) TS string body into its runtime value.
 * JSON.parse only accepts double-quoted bodies, so this handles the escape
 * sequences directly for the non-double-quoted case. `\\X` → the escaped char
 * (with the standard `\\n`/`\\t`/… expansions); everything else is literal.
 */
function unescapeAltQuoted(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (_, esc) => {
    switch (esc[0]) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "b": return "\b";
      case "f": return "\f";
      case "v": return "\v";
      case "0": return "\0";
      case "u":
      case "x": return String.fromCharCode(parseInt(esc.slice(1), 16));
      default: return esc[0]; // \\ \" \' \` \/ … → the literal char
    }
  });
}

/** Unescape a captured string body given its opening quote char. */
function unquoteAny(quote, raw) {
  // Double-quoted: reuse the existing JSON.parse('"'+raw+'"') path.
  if (quote === '"') return unquote(raw);
  return unescapeAltQuoted(raw);
}

/**
 * Extract a `name: "value"` (or `'value'`, or `"name"`/`'name'` key) string
 * field from an object-literal body regardless of property order, or undefined.
 * The key must sit at a property boundary (`{`, `,`, or whitespace) so a search
 * for `id` never matches inside `menuId`.
 */
function stringField(body, name) {
  const re = new RegExp(
    `(?:^|[,{\\s])["']?${name}["']?\\s*:\\s*(["'])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`,
  );
  const m = re.exec(body);
  return m ? unquoteAny(m[1], m[2]) : undefined;
}

/**
 * Split an array-body region into balanced top-level `{ … }` object literals by
 * brace-counting (property ORDER does not matter). It is a small lexer: string
 * contents (single, double, or backtick quoted, with escapes), `//` line
 * comments, and `/* … *\/` block comments are all skipped, so a brace, quote, or
 * apostrophe living inside a string value or a comment (e.g. `browser's`) never
 * corrupts the depth count. Without comment/string awareness a stray quote char
 * swallows every following entry — a silent fail-open.
 */
function splitObjectLiterals(region, rel, name) {
  const literals = [];
  let depth = 0;
  let start = -1;
  let quote = null; // active string quote char, or null
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < region.length; i++) {
    const c = region[i];
    const next = region[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      lineComment = true;
      i++;
    } else if (c === "/" && next === "*") {
      blockComment = true;
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          literals.push(region.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  // Fail closed on a lexer that ran off the rails: an unterminated string or
  // block comment, or an unbalanced brace, means we could have silently swallowed
  // real entries — never trust a partial parse.
  if (quote !== null) {
    fail(`${rel}: ${name} — unterminated ${quote}-quoted string while splitting object literals`);
  }
  if (blockComment) {
    fail(`${rel}: ${name} — unterminated block comment while splitting object literals`);
  }
  if (depth !== 0) {
    fail(`${rel}: ${name} — unbalanced braces (depth ${depth}) while splitting object literals`);
  }
  return literals;
}

/**
 * Parse an array of `{ ... }` object literals from a TS source region.
 * `region` must already be narrowed to the array body. Fails closed: every
 * balanced literal must yield a string `id`, and the parsed-entry count must
 * equal the literal count — an entry whose shape hides its `id` (id last,
 * single-quoted, spread, shorthand, …) aborts the gate instead of being
 * silently dropped.
 */
function parseObjectLiterals(region, rel, name) {
  const literals = splitObjectLiterals(region, rel, name);
  const out = [];
  for (const body of literals) {
    const id = stringField(body, "id");
    if (id === undefined) {
      const fragment = body.replace(/\s+/g, " ").trim().slice(0, 160);
      const menuId = stringField(body, "menuId");
      const hint = menuId
        ? ` — this entry has menuId "${menuId}" but no extractable string \`id\``
        : " — no extractable string `id`";
      fail(
        `${rel}: ${name} contains an object literal the drift gate cannot parse${hint}. ` +
          `Fragment: ${fragment}\n  The gate fails closed: give the entry a plain ` +
          `\`id: "…"\` property so its accelerator can be verified.`,
      );
    }
    out.push({
      id,
      defaultKey: stringField(body, "defaultKey"),
      defaultKeyMac: stringField(body, "defaultKeyMac"),
      defaultKeyOther: stringField(body, "defaultKeyOther"),
      menuId: stringField(body, "menuId"),
    });
  }
  // Belt-and-suspenders: one parsed entry per balanced literal (unreachable
  // after the per-literal fail() above, but makes the invariant explicit).
  if (out.length !== literals.length) {
    fail(
      `${rel}: ${name} parsed ${out.length} entries from ${literals.length} object ` +
        `literals — the gate fails closed on any dropped entry`,
    );
  }
  return out;
}

/** Narrow source to the body of `const NAME ... = [ ... ];`. */
function arrayBody(src, name, rel) {
  const start = src.indexOf(name);
  if (start === -1) fail(`${rel}: could not find ${name}`);
  const open = src.indexOf("[", start);
  if (open === -1) fail(`${rel}: no array opening after ${name}`);
  const close = src.indexOf("];", open);
  if (close === -1) fail(`${rel}: no array closing after ${name}`);
  return src.slice(open, close);
}

// --- Load manifest ---
const manifestSrc = readOrDie(MANIFEST_PATH);
const manifest = parseObjectLiterals(
  arrayBody(manifestSrc, "KEYBINDING_MANIFEST", MANIFEST_PATH),
  MANIFEST_PATH,
  "KEYBINDING_MANIFEST",
);
if (manifest.length === 0) fail(`${MANIFEST_PATH}: parsed zero manifest entries`);

// --- Load frontend definitions ---
const defsSrc = readOrDie(DEFS_PATH);
const defs = parseObjectLiterals(
  arrayBody(defsSrc, "DEFAULT_SHORTCUTS", DEFS_PATH),
  DEFS_PATH,
  "DEFAULT_SHORTCUTS",
);
if (defs.length === 0) fail(`${DEFS_PATH}: parsed zero shortcut definitions`);
const defById = new Map(defs.map((d) => [d.id, d]));

// --- Load Rust contract tables ---
const rustSrc = readOrDie(RUST_PATH);
const rustDefaultBody = arrayBody(rustSrc, "const DEFAULT_ACCELERATORS", RUST_PATH);
const rustPlatformBody = arrayBody(rustSrc, "const PLATFORM_ACCELERATORS", RUST_PATH);
const rustDefault = new Map();
for (const m of rustDefaultBody.matchAll(/\("([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)"\)/g)) {
  rustDefault.set(m[1], unquote(m[2]));
}
const rustPlatform = new Map();
for (const m of rustPlatformBody.matchAll(/\("([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\)/g)) {
  rustPlatform.set(m[1], { mac: unquote(m[2]), other: unquote(m[3]) });
}
if (rustDefault.size === 0) fail(`${RUST_PATH}: parsed zero DEFAULT_ACCELERATORS entries`);
if (rustPlatform.size === 0) fail(`${RUST_PATH}: parsed zero PLATFORM_ACCELERATORS entries`);

// --- Load the REAL Rust menu builder (accel(...) call sites) ---
const { realDefault, realPlatform } = parseRealMenu();

// --- Load the docs table accelerators ---
const docsSrc = readOrDie(DOCS_PATH);
const docsAccels = buildDocsAccelSet(docsSrc, DOCS_PATH);

const manifestMenuIds = new Set(manifest.map((e) => e.menuId).filter(Boolean));

// --- Per-entry checks ---
const seenIds = new Set();
for (const entry of manifest) {
  const { id, menuId } = entry;
  if (seenIds.has(id)) {
    errors.push(`manifest: duplicate id "${id}"`);
    continue;
  }
  seenIds.add(id);

  if (!menuId) {
    errors.push(`manifest "${id}": missing menuId`);
    continue;
  }

  // 1. Matches the frontend definition.
  const def = defById.get(id);
  if (!def) {
    errors.push(`manifest "${id}": no matching entry in ${DEFS_PATH}`);
    continue;
  }
  const defKey = def.defaultKey ?? "";
  const manKey = entry.defaultKey ?? "";
  if (manKey !== defKey) {
    errors.push(`"${id}": manifest defaultKey "${manKey}" !== ${DEFS_PATH} "${defKey}"`);
  }
  const defOther = def.defaultKeyOther;
  const manOther = entry.defaultKeyOther;
  if (defOther !== manOther) {
    errors.push(
      `"${id}": manifest defaultKeyOther ${JSON.stringify(manOther)} !== ` +
        `${DEFS_PATH} ${JSON.stringify(defOther)}`,
    );
  }
  if ((def.menuId ?? "") !== menuId) {
    errors.push(`"${id}": manifest menuId "${menuId}" !== ${DEFS_PATH} "${def.menuId ?? ""}"`);
  }

  // 2. Matches the Rust menu accelerator contract.
  if (rustPlatform.has(menuId)) {
    const { mac, other } = rustPlatform.get(menuId);
    const gotMac = prosemirrorToTauri(manKey);
    const gotOther = prosemirrorToTauri(manOther ?? "");
    if (gotMac !== mac) {
      errors.push(`"${id}" (${menuId}): macOS accel ${JSON.stringify(gotMac)} !== Rust ${JSON.stringify(mac)}`);
    }
    if (gotOther !== other) {
      errors.push(`"${id}" (${menuId}): other accel ${JSON.stringify(gotOther)} !== Rust ${JSON.stringify(other)}`);
    }
  } else if (rustDefault.has(menuId)) {
    const got = prosemirrorToTauri(manKey);
    const want = rustDefault.get(menuId);
    if (got !== want) {
      errors.push(`"${id}" (${menuId}): accel ${JSON.stringify(got)} !== Rust ${JSON.stringify(want)}`);
    }
  } else {
    errors.push(`"${id}" (${menuId}): menuId absent from Rust DEFAULT_ACCELERATORS / PLATFORM_ACCELERATORS`);
  }

  // 3. Matches the REAL menu builder's accel(...) call site (not just the mirror).
  const wantAccel = prosemirrorToTauri(manKey);
  if (manOther !== undefined) {
    const rp = realPlatform.get(menuId);
    if (!rp) {
      errors.push(
        `"${id}" (${menuId}): manifest is platform-conditional but the real menu ` +
          `builder (${LOCALIZED_DIR}) has no platform-conditional accel("${menuId}", …) site`,
      );
    } else {
      const wantOther = prosemirrorToTauri(manOther);
      if (rp.mac !== wantAccel) {
        errors.push(`"${id}" (${menuId}): real menu macOS accel ${JSON.stringify(rp.mac)} !== prosemirrorToTauri(defaultKey) ${JSON.stringify(wantAccel)}`);
      }
      if (rp.other !== wantOther) {
        errors.push(`"${id}" (${menuId}): real menu other accel ${JSON.stringify(rp.other)} !== prosemirrorToTauri(defaultKeyOther) ${JSON.stringify(wantOther)}`);
      }
    }
  } else if (realDefault.has(menuId)) {
    const got = realDefault.get(menuId);
    if (got !== wantAccel) {
      errors.push(`"${id}" (${menuId}): real menu accel ${JSON.stringify(got)} !== prosemirrorToTauri(defaultKey) ${JSON.stringify(wantAccel)}`);
    }
  } else if (realPlatform.has(menuId)) {
    errors.push(`"${id}" (${menuId}): real menu builder is platform-conditional but the manifest entry is not`);
  } else {
    errors.push(`"${id}" (${menuId}): no accel("${menuId}", …) call site in the real menu builder ${LOCALIZED_DIR}`);
  }

  // 4. Documented in the website shortcuts table (order-insensitive).
  if (manKey === "") {
    // Deliberately unbound: docs render it as "—" / "Menu only" / "(customizable)".
    // Nothing to locate; the empty accelerator is already covered above.
  } else if (DOCS_RANGE_DOCUMENTED.has(menuId)) {
    // Documented only inside a compressed range cell — allowed exception.
  } else {
    const canonMain = canonAccel(keyTokens(manKey));
    if (!docsAccels.has(canonMain)) {
      errors.push(
        `"${id}" (${menuId}): accelerator "${prosemirrorToDocs(manKey)}" is missing ` +
          `from the docs table ${DOCS_PATH} — a menu-backed shortcut must be documented`,
      );
    }
    if (manOther !== undefined && manOther !== "") {
      const canonOther = canonAccel(keyTokens(manOther));
      if (!docsAccels.has(canonOther)) {
        errors.push(
          `"${id}" (${menuId}): Windows/Linux accelerator "${prosemirrorToDocs(manOther)}" ` +
            `is missing from the docs table ${DOCS_PATH}`,
        );
      }
    }
  }
}

// --- Reverse: every non-empty accel the real menu binds maps to a manifest entry ---
function reportOrphanRealAccel(id, accelDesc) {
  if (manifestMenuIds.has(id)) return;
  if (DYNAMIC_MENU_IDS.has(id)) return;
  if (NON_MANIFEST_MENU_ACCELS.has(id)) return;
  errors.push(
    `real menu builder binds ${accelDesc} to menu id "${id}", which is absent from ` +
      `the manifest — add a KEYBINDING_MANIFEST entry (or allow-list it in ` +
      `NON_MANIFEST_MENU_ACCELS with a reason)`,
  );
}
for (const [id, accel] of realDefault) {
  if (accel === "") continue; // unbound-by-default menu item: nothing to reconcile
  reportOrphanRealAccel(id, JSON.stringify(accel));
}
for (const [id, { mac, other }] of realPlatform) {
  if (mac === "" && other === "") continue;
  reportOrphanRealAccel(id, `${JSON.stringify(mac)}/${JSON.stringify(other)}`);
}

// --- Completeness: every synced frontend menuId is covered ---
for (const def of defs) {
  if (!def.menuId) continue;
  if (DYNAMIC_MENU_IDS.has(def.menuId)) continue;
  if (!seenIds.has(def.id)) {
    errors.push(
      `"${def.id}" (${def.menuId}) has a menu accelerator in ${DEFS_PATH} ` +
        `but is missing from the manifest — add it to KEYBINDING_MANIFEST`,
    );
  }
}

if (errors.length > 0) {
  console.error(`\n❌ Keybinding drift gate found ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    "\n  The manifest, shortcutDefinitions.ts, the real Rust menu builder " +
      `(${LOCALIZED_DIR}), and the docs table (${DOCS_PATH})\n  have diverged. ` +
      "Reconcile all four per .claude/rules/41-keyboard-shortcuts.md.",
  );
  process.exit(1);
}

console.log(
  `✅ Keybinding drift gate passed (${manifest.length} synced entries aligned across ` +
    `manifest, shortcutDefinitions.ts, the real Rust menu builder, and the docs table).`,
);
