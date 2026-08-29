#!/usr/bin/env node
/**
 * Keybinding drift gate (WI-1.5 / Phase 8; gap audit #2).
 *
 * A keyboard shortcut with a native menu accelerator lives in THREE sources that
 * must agree (`.claude/rules/41-keyboard-shortcuts.md`):
 *   1. `src/stores/settingsStore/shortcutDefinitions.ts` — frontend defaults,
 *      the source of truth; the synced subset is DERIVED from it here (every
 *      entry with a `menuId`, minus the dynamically-bound ones)
 *   2. `src-tauri/src/menu/localized/*.rs` — the REAL Rust menu builder
 *      (`accel("<menu-id>", "<default-accel>")` call sites), pinned as a contract
 *      mirror in `src-tauri/src/menu/localized.test.rs`
 *      (`DEFAULT_ACCELERATORS` / `PLATFORM_ACCELERATORS`)
 *   3. `website/guide/shortcuts.md` — the human-readable docs table
 *
 * There used to be a fourth: a hand-written `keybindingManifest.ts` restating
 * each entry's keys, which this gate then compared against the definitions it
 * was copied from. That comparison could only fail if someone forgot to copy —
 * it caught clerical omissions, never drift. Everything that catches real drift
 * compares ACROSS LANGUAGES, and all of it survives derivation.
 *
 * For every synced entry this gate asserts:
 *   - the Rust CONTRACT MIRROR accelerator for the entry's `menuId` equals
 *     `prosemirrorToTauri(defaultKey)` (and `prosemirrorToTauri(defaultKeyOther)`
 *     for platform-conditional entries),
 *   - the REAL menu builder's `accel(...)` call site for that `menuId` equals the
 *     same value (closing the "checked against a test mirror, not the real menu"
 *     gap — a drift between the mirror and the real builder is now visible here,
 *     not only in the macOS-only Rust test), and
 *   - the docs table lists the entry's accelerator (order-insensitively; a
 *     menu-backed shortcut must be documented).
 * It also asserts the reverse direction: every non-empty accelerator the real
 * menu builder binds must map to a synced entry (or an explicit allow-listed id
 * with a stated reason).
 *
 * Everything is parsed as text (no TS/Rust runtime), so the gate runs under plain
 * `node`. It fails closed: a missing file, unreadable table, or parse error
 * exits non-zero. Run via `pnpm lint:keybinding-manifest` (wired into check:all).
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];
    // Skip comments and string literals so an `accel(` token that lives INSIDE
    // one (a commented-out call, or the substring in an unrelated string) is never
    // mistaken for a real call site — the header promise the old outer scan didn't
    // keep (audit-fix, round 3). The inner arg scanner below skips these too.
    if (ch === "/" && nx === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (ch === "/" && nx === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) fail(`${rel}: unterminated block comment while scanning for accel(...)`);
      i = end + 2;
      continue;
    }
    if (ch === '"') {
      [, i] = readRustString(src, i, rel);
      continue;
    }
    // Require a call boundary: the char before `accel` must not be an identifier
    // char (so `AccelFn`, `my_accel(` etc. never match).
    if (ch !== "a" || !src.startsWith("accel(", i)) {
      i += 1;
      continue;
    }
    const prev = i > 0 ? src[i - 1] : " ";
    if (/[A-Za-z0-9_]/.test(prev)) {
      i += 1;
      continue;
    }
    let j = i + "accel(".length;
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
      label: stringField(body, "label"),
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
  // Anchor on the DECLARATION, not the first mention of the name. `indexOf`
  // matched the name inside the file's header comment and then took whatever
  // `[` came next — which stayed correct only while no other array happened to
  // be declared in between. Adding one (the category table) silently made this
  // parse the wrong array and report zero definitions.
  // `const`/`let`/`var`/`static` covers both the TS sources and the Rust
  // contract mirror, whose arrays are `const NAME: &[(&str, &str)] = &[`.
  // Callers used to pass "const NAME" to dodge the comment-mention problem;
  // the declaration anchor makes the identifier alone sufficient either way.
  const ident = name.trim().split(/\s+/).pop();
  const decl = new RegExp(`(?:const|let|var|static)\\s+${ident}\\b[^=\\n]*=\\s*&?\\s*\\[`);
  const m = decl.exec(src);
  if (!m) fail(`${rel}: could not find a declaration of ${ident}`);
  const open = m.index + m[0].length - 1;
  const close = src.indexOf("];", open);
  if (close === -1) fail(`${rel}: no array closing after ${name}`);
  return src.slice(open, close);
}

// --- Load frontend definitions ---
const defsSrc = readOrDie(DEFS_PATH);
const defs = parseObjectLiterals(
  arrayBody(defsSrc, "DEFAULT_SHORTCUTS", DEFS_PATH),
  DEFS_PATH,
  "DEFAULT_SHORTCUTS",
);

// --- Derive the synced subset ---
// Every definition carrying a `menuId`, minus the dynamically-bound ones. This
// used to be a hand-copied file (`keybindingManifest.ts`) that the gate then
// compared against these same definitions — an equality between two copies of
// one value, which cannot fail unless someone forgets to copy. What actually
// catches drift is the comparison against the OTHER languages: the Rust mirror,
// the real menu builder, and the docs table. Those run against the derived set
// unchanged.
const manifest = defs
  .filter((d) => d.menuId && !DYNAMIC_MENU_IDS.has(d.menuId))
  .map((d) => ({
    id: d.id,
    label: d.label,
    defaultKey: d.defaultKey,
    defaultKeyMac: d.defaultKeyMac,
    defaultKeyOther: d.defaultKeyOther,
    menuId: d.menuId,
  }));
if (manifest.length === 0) fail(`${DEFS_PATH}: derived zero menu-backed shortcuts`);
if (defs.length === 0) fail(`${DEFS_PATH}: parsed zero shortcut definitions`);
const defById = new Map(defs.map((d) => [d.id, d]));

// --- Load Rust contract tables ---
const rustSrc = readOrDie(RUST_PATH);
const rustDefaultBody = arrayBody(rustSrc, "const DEFAULT_ACCELERATORS", RUST_PATH);
const rustPlatformBody = arrayBody(rustSrc, "const PLATFORM_ACCELERATORS", RUST_PATH);
// Duplicate ids in either contract table (or an id in BOTH) silently overwrote
// earlier entries via Map.set — a wrong-then-right duplicate would let the gate
// validate against the surviving tuple and pass. Fail closed on any duplicate
// (audit-fix, round 3).
const rustDefault = new Map();
for (const m of rustDefaultBody.matchAll(/\("([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)"\)/g)) {
  if (rustDefault.has(m[1])) fail(`${RUST_PATH}: duplicate id "${m[1]}" in DEFAULT_ACCELERATORS`);
  rustDefault.set(m[1], unquote(m[2]));
}
const rustPlatform = new Map();
for (const m of rustPlatformBody.matchAll(/\("([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\)/g)) {
  if (rustPlatform.has(m[1])) fail(`${RUST_PATH}: duplicate id "${m[1]}" in PLATFORM_ACCELERATORS`);
  if (rustDefault.has(m[1])) {
    fail(`${RUST_PATH}: id "${m[1]}" appears in BOTH DEFAULT_ACCELERATORS and PLATFORM_ACCELERATORS`);
  }
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

  const def = defById.get(id);
  if (!def) {
    // Unreachable while the set is derived from `defs`; kept as a fail-closed
    // guard so a future re-plumbing of the source cannot skip entries silently.
    errors.push(`"${id}": no matching entry in ${DEFS_PATH}`);
    continue;
  }
  const manKey = entry.defaultKey ?? "";
  const manOther = entry.defaultKeyOther;
  // `defaultKeyMac` is runtime-wired (settingsStore/shortcuts.ts resolves it on
  // macOS) but no entry uses it yet. Still validate it so the day one appears, the
  // gate compares the macOS surfaces against the override rather than defaultKey
  // (audit-fix, round 3). `macKey`/`manMac` below feed the macOS Rust + real-menu
  // checks; they collapse to `manKey` while defaultKeyMac is absent.
  const defMac = def.defaultKeyMac;
  const manMac = entry.defaultKeyMac;
  if (defMac !== manMac) {
    errors.push(
      `"${id}": manifest defaultKeyMac ${JSON.stringify(manMac)} !== ` +
        `${DEFS_PATH} ${JSON.stringify(defMac)}`,
    );
  }
  const macKey = manMac ?? manKey;
  if ((def.menuId ?? "") !== menuId) {
    errors.push(`"${id}": manifest menuId "${menuId}" !== ${DEFS_PATH} "${def.menuId ?? ""}"`);
  }

  // 2. Matches the Rust menu accelerator contract.
  if (rustPlatform.has(menuId)) {
    const { mac, other } = rustPlatform.get(menuId);
    const gotMac = prosemirrorToTauri(macKey);
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
  const wantAccelMac = prosemirrorToTauri(macKey);
  if (manOther !== undefined) {
    const rp = realPlatform.get(menuId);
    if (!rp) {
      errors.push(
        `"${id}" (${menuId}): manifest is platform-conditional but the real menu ` +
          `builder (${LOCALIZED_DIR}) has no platform-conditional accel("${menuId}", …) site`,
      );
    } else {
      const wantOther = prosemirrorToTauri(manOther);
      if (rp.mac !== wantAccelMac) {
        errors.push(`"${id}" (${menuId}): real menu macOS accel ${JSON.stringify(rp.mac)} !== prosemirrorToTauri(defaultKeyMac ?? defaultKey) ${JSON.stringify(wantAccelMac)}`);
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
      `the synced set — give it a menuId entry in ${DEFS_PATH} (or allow-list ` +
      `it in NON_MANIFEST_MENU_ACCELS with a reason)`,
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

// --- Label parity (WI-UI4.3): ONE label per command ------------------------
//
// The native menu's en.yml label (minus a trailing ellipsis) must equal the
// shortcutDefinitions label for every menu-backed id: the palette, Settings
// shortcuts and toolbar tooltips all read the definitions label, so a menu
// that says something else is the "two names, one command" drift this gate
// exists to kill. Exemptions carry a reason, in the compressed-range style.
// A SUBMENU item inherits its parent's noun ("Insert → Image"), while the
// flat surfaces (palette, Settings, tooltips) must stand alone ("Insert
// Image"). Byte equality would force verbose menus or ambiguous flat labels,
// so the submenu-context class is exempt BY ID with the folding stated.
// Each exemption RECORDS BOTH labels it exempts (the menu side and the
// definitions side): an exemption that accepted any non-equal pair would let
// EITHER label drift to anything while staying green. A change on either side
// of an exempt id now fails until the recorded tuple is updated — the drift
// gets reviewed, not absorbed.
const LABEL_EXEMPT = new Map([
  ["image", { menu: "Image", defs: "Insert Image", reason: "Insert submenu supplies the verb — flat label folds it in (Insert Image)" }],
  ["video", { menu: "Video", defs: "Insert Video", reason: "Insert submenu supplies the verb (Insert Video)" }],
  ["audio", { menu: "Audio", defs: "Insert Audio", reason: "Insert submenu supplies the verb (Insert Audio)" }],
  ["diagram", { menu: "Diagram", defs: "Insert Diagram", reason: "Insert submenu supplies the verb (Insert Diagram)" }],
  ["graphviz-diagram", { menu: "Graphviz Diagram", defs: "Insert Graphviz Diagram", reason: "Insert submenu supplies the verb (Insert Graphviz Diagram)" }],
  ["mindmap", { menu: "Mindmap", defs: "Insert Mindmap", reason: "Insert submenu supplies the verb (Insert Mindmap)" }],
  ["info-note", { menu: "Note", defs: "Insert Note", reason: "Info Box submenu supplies the noun (Insert Note)" }],
  ["info-tip", { menu: "Tip", defs: "Insert Tip", reason: "Info Box submenu supplies the noun (Insert Tip)" }],
  ["info-warning", { menu: "Warning", defs: "Insert Warning", reason: "Info Box submenu supplies the noun (Insert Warning)" }],
  ["info-important", { menu: "Important", defs: "Insert Important", reason: "Info Box submenu supplies the noun (Insert Important)" }],
  ["info-caution", { menu: "Caution", defs: "Insert Caution", reason: "Info Box submenu supplies the noun (Insert Caution)" }],
  ["collapsible-block", { menu: "Collapsible Block", defs: "Insert Collapsible Block", reason: "Insert menu supplies the verb (Insert Collapsible Block)" }],
  ["export-html", { menu: "HTML", defs: "Export HTML", reason: "Export submenu supplies the verb (Export HTML)" }],
  ["export-pdf-native", { menu: "PDF", defs: "Export PDF", reason: "Export submenu supplies the verb (Export PDF)" }],
  ["transform-uppercase", { menu: "UPPERCASE", defs: "Transform to UPPERCASE", reason: "Transform submenu supplies the verb (Transform to UPPERCASE)" }],
  ["transform-lowercase", { menu: "lowercase", defs: "Transform to lowercase", reason: "Transform submenu supplies the verb (Transform to lowercase)" }],
  ["transform-title-case", { menu: "Title Case", defs: "Transform to Title Case", reason: "Transform submenu supplies the verb (Transform to Title Case)" }],
  ["format-cjk", { menu: "Format Selection", defs: "Format CJK Selection", reason: "CJK submenu supplies the noun — flat canonical is Format CJK Selection (WI-UI4.3)" }],
  ["format-cjk-file", { menu: "Format Entire File", defs: "Format CJK File", reason: "CJK submenu supplies the noun — flat canonical is Format CJK File (WI-UI4.3)" }],
  ["new", { menu: "New", defs: "New File", reason: "the File MENU column supplies the noun (New); the flat label stands alone (New File)" }],
]);

// Manifest ids with NO Rust label pair, each with a stated reason. Any other
// unpaired id fails — silent skips are how a builder rewrite would blind the
// whole leg while it kept reporting green. EMPTY today: every manifest id
// pairs (the one dynamic id, search-genies, is excluded from the manifest by
// DYNAMIC_MENU_IDS before this leg runs).
const UNPAIRED_OK = new Map([]);

function menuLabelPairs() {
  const pairs = new Map(); // menu id -> en.yml key
  for (const file of readdirSync(join(ROOT, LOCALIZED_DIR)).filter((f) => f.endsWith(".rs") && !f.endsWith(".test.rs"))) {
    const src = readOrDie(`${LOCALIZED_DIR}/${file}`);
    // `with_id(app, "<id>", &t!("menu.<key>")` — id and label key co-occur in
    // one builder call. Comments were a hazard for accel(); labels only ever
    // appear in real calls, and a duplicate id keeps its first label.
    for (const m of src.matchAll(/"([a-z0-9-]+)",\s*&t!\("([A-Za-z0-9_.]+)"\)/g)) {
      if (!pairs.has(m[1])) pairs.set(m[1], m[2]);
    }
  }
  return pairs;
}

function enYmlLabels() {
  const raw = readOrDie("src-tauri/locales/en.yml");
  const labels = new Map();
  for (const line of raw.split("\n")) {
    const m = /^\s{2}([A-Za-z0-9_.]+):\s*"(.*)"\s*$/.exec(line);
    if (m) labels.set(`menu.${m[1]}`, m[2]);
  }
  return labels;
}

{
  const pairs = menuLabelPairs();
  const ymlLabels = enYmlLabels();
  for (const entry of manifest) {
    const key = pairs.get(entry.menuId);
    if (!key) {
      // No silent skips: every unpaired id is either in the reasoned
      // allowlist or a failure. A builder rewrite that breaks
      // menuLabelPairs()'s pattern now fails on the FIRST id, not never.
      if (!UNPAIRED_OK.has(entry.menuId)) {
        errors.push(
          `menu id "${entry.menuId}" has no label pair in the Rust builder — ` +
            `menuLabelPairs() missed it (pattern drift?), or add a reasoned UNPAIRED_OK entry.`,
        );
      }
      continue;
    }
    if (UNPAIRED_OK.has(entry.menuId)) {
      errors.push(`stale UNPAIRED_OK entry "${entry.menuId}": the id pairs now — remove the exemption.`);
    }
    const menuLabel = ymlLabels.get(key);
    if (menuLabel === undefined) {
      errors.push(`menu id "${entry.menuId}" labels via t!("${key}") but en.yml has no such key`);
      continue;
    }
    const canonMenu = menuLabel.replace(/…$/, "").trim();
    const exempt = LABEL_EXEMPT.get(entry.menuId);
    if (exempt) {
      // An exemption whose fold has quietly become byte-equal no longer
      // exempts anything — delete it rather than let it mask future drift.
      if (canonMenu === entry.label) {
        errors.push(
          `stale LABEL_EXEMPT entry "${entry.menuId}": menu and definitions labels are now identical ` +
            `(${JSON.stringify(entry.label)}) — remove the exemption.`,
        );
      } else if (canonMenu !== exempt.menu) {
        errors.push(
          `LABEL_EXEMPT entry "${entry.menuId}" recorded menu label ${JSON.stringify(exempt.menu)} ` +
            `but the menu now says ${JSON.stringify(canonMenu)} — re-review the exemption and update its recorded label.`,
        );
      } else if (entry.label !== exempt.defs) {
        errors.push(
          `LABEL_EXEMPT entry "${entry.menuId}" recorded definitions label ${JSON.stringify(exempt.defs)} ` +
            `but ${DEFS_PATH} now says ${JSON.stringify(entry.label)} — re-review the exemption and update its recorded label.`,
        );
      }
      continue;
    }
    if (canonMenu !== entry.label) {
      errors.push(
        `label drift for "${entry.menuId}": menu says ${JSON.stringify(canonMenu)} (en.yml ${key}) ` +
          `but ${DEFS_PATH} says ${JSON.stringify(entry.label)} — one command, one label (WI-UI4.3)`,
      );
    }
  }
  // Exemption liveness, the other direction: an exempt id that no longer
  // exists in the manifest is a rename the map silently outlived.
  const manifestIds = new Set(manifest.map((e) => e.menuId));
  for (const id of [...LABEL_EXEMPT.keys(), ...UNPAIRED_OK.keys()]) {
    if (!manifestIds.has(id)) {
      errors.push(`stale exemption "${id}": no such menu id in the manifest — remove it.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`\n❌ Keybinding drift gate found ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    `\n  ${DEFS_PATH}, the real Rust menu builder (${LOCALIZED_DIR}), and the ` +
      `docs table (${DOCS_PATH})\n  have diverged. ` +
      "Reconcile all three per .claude/rules/41-keyboard-shortcuts.md.",
  );
  process.exit(1);
}

console.log(
  `✅ Keybinding drift gate passed (${manifest.length} menu-backed shortcuts aligned ` +
    `across ${DEFS_PATH}, the real Rust menu builder, and the docs table).`,
);
