#!/usr/bin/env node
/**
 * Keybinding drift gate (WI-1.5 / Phase 8).
 *
 * A keyboard shortcut with a native menu accelerator lives in three sources that
 * must agree (`.claude/rules/41-keyboard-shortcuts.md`):
 *   1. `src/services/keybinding/keybindingManifest.ts` — the manifest (source of truth)
 *   2. `src/stores/settingsStore/shortcutDefinitions.ts` — frontend defaults
 *   3. `src-tauri/src/menu/localized.test.rs` — Rust menu accelerator contract
 *      (`DEFAULT_ACCELERATORS` / `PLATFORM_ACCELERATORS`)
 *
 * For every manifest entry this gate asserts:
 *   - `defaultKey` / `defaultKeyOther` equal the `shortcutDefinitions.ts` entry, and
 *   - the Rust accelerator for the entry's `menuId` equals `prosemirrorToTauri(defaultKey)`
 *     (and `prosemirrorToTauri(defaultKeyOther)` for platform-conditional entries).
 * It also asserts completeness: every `shortcutDefinitions.ts` entry that has a
 * `menuId` (minus the dynamically-bound `search-genies`) must appear in the manifest.
 *
 * Everything is parsed as text (no TS runtime), so the gate runs under plain
 * `node`. It fails closed: a missing file, unreadable table, or parse error
 * exits non-zero. Run via `pnpm lint:keybinding-manifest` (wired into check:all).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "src/services/keybinding/keybindingManifest.ts";
const DEFS_PATH = "src/stores/settingsStore/shortcutDefinitions.ts";
const RUST_PATH = "src-tauri/src/menu/localized.test.rs";

/** Menu ids whose accelerator is registered dynamically, not via a static menu accel. */
const DYNAMIC_MENU_IDS = new Set(["search-genies"]);

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
    "\n  The manifest, shortcutDefinitions.ts, and the Rust accelerator contract " +
      "have diverged.\n  Reconcile all three per .claude/rules/41-keyboard-shortcuts.md.",
  );
  process.exit(1);
}

console.log(
  `✅ Keybinding drift gate passed (${manifest.length} synced entries aligned across ` +
    `manifest, shortcutDefinitions.ts, and the Rust accelerator contract).`,
);
