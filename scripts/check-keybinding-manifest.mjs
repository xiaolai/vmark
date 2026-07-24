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

/** Extract a `name: "value"` string field from an object-literal body, or undefined. */
function stringField(body, name) {
  const re = new RegExp(`\\b${name}:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = re.exec(body);
  return m ? unquote(m[1]) : undefined;
}

/**
 * Parse an array of `{ ... }` object literals from a TS source region.
 * `region` must already be narrowed to the array body.
 */
function parseObjectLiterals(region) {
  const out = [];
  const objRe = /\{\s*id:\s*"([^"]+)"[^}]*\}/g;
  let m;
  while ((m = objRe.exec(region))) {
    const body = m[0];
    out.push({
      id: m[1],
      defaultKey: stringField(body, "defaultKey"),
      defaultKeyMac: stringField(body, "defaultKeyMac"),
      defaultKeyOther: stringField(body, "defaultKeyOther"),
      menuId: stringField(body, "menuId"),
    });
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
const manifest = parseObjectLiterals(arrayBody(manifestSrc, "KEYBINDING_MANIFEST", MANIFEST_PATH));
if (manifest.length === 0) fail(`${MANIFEST_PATH}: parsed zero manifest entries`);

// --- Load frontend definitions ---
const defsSrc = readOrDie(DEFS_PATH);
const defs = parseObjectLiterals(arrayBody(defsSrc, "DEFAULT_SHORTCUTS", DEFS_PATH));
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
