/**
 * WI-4.1 — mechanic-extraction gate (gap audit #1).
 *
 * The sibling `editorMechanics.test.ts` only checks the APPROVED_MECHANICS
 * allowlist for INTERNAL consistency (disjoint from commands / shortcuts / menu
 * ids). It never looks at the REAL editor keymaps, so a NEW unclassified chord or
 * action added to a PM/CM keymap is invisible to it. This gate closes that gap: it
 * SOURCE-SCANS every editor keymap producer (all non-test `.ts`/`.tsx` under
 * `src/plugins/**` — which includes `codemirror/**` — and `src/services/assembly/**`)
 * and asserts that every ACTION a binding invokes is exactly ONE of:
 *
 *   1. a rebindable shortcut — `getShortcut("<id>")` with `<id>` ∈ DEFAULT_SHORTCUTS,
 *   2. a registered CommandBus command — `runEditorAction("<id>")` (→ `editor.<id>`,
 *      with the `setHeading` → `editor.setHeading.1..6` projection tolerated),
 *      `runCommand("editor.<id>")`, or `executeCommand("<id>")`, or
 *   3. an approved structural mechanic — a hardcoded-chord bespoke handler that is
 *      declared in APPROVED_MECHANICS.
 *
 * Anything matching none of the three is UNCLASSIFIED and FAILS the gate — a new
 * chord/action can no longer slip into a keymap without a conscious "route it
 * through a command/shortcut, or declare it an approved mechanic" decision.
 *
 * The scan reads source text (it does NOT execute the keymaps). Floor assertions
 * on each extracted set guard against a silently-broken regex vacuously passing.
 *
 * CONSOLIDATED — `src/plugins/markInputRules/tiptap.ts` USED to bind `Mod-b` /
 * `Mod-i` to Tiptap's built-in `toggleBold` / `toggleItalic`, duplicating (and
 * shadowed by) the rebindable `bold` / `italic` keys the store-driven
 * `editorKeymapExtension` owns. That gate-audit follow-up is now done: those
 * `addKeyboardShortcuts` were removed, so `Mod-b`/`Mod-i` have exactly one
 * authority (the rebindable path). markInputRules now adds no keyboard shortcuts.
 *
 * @coordinates-with services/keybinding/editorMechanics.ts — APPROVED_MECHANICS
 * @coordinates-with services/commands/editorCommandBridge.ts — editor.* surface
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { APPROVED_MECHANICS, APPROVED_MECHANIC_IDS } from "./editorMechanics";
import { getCommand, _resetCommandBus } from "@/services/commands/CommandBus";
import { registerEditorCommands } from "@/services/commands/editorCommandBridge";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";
import { registerMiscCommands } from "@/services/commands/miscCommands";
import { registerViewCommands } from "@/services/commands/viewCommands";
import { registerBrowserCommands } from "@/services/commands/browserCommands";
import { registerTabCommands } from "@/hooks/tabCommands";
import { registerFileCommands } from "@/hooks/fileCommands";
import { registerGenieCommands } from "@/services/commands/genieCommands";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", ".."); // .../src
const SCAN_DIRS = [join(SRC_ROOT, "plugins"), join(SRC_ROOT, "services", "assembly")];

const shortcutIds = new Set(DEFAULT_SHORTCUTS.map((s) => s.id));

/** Collect every non-test `.ts`/`.tsx` file under `dir`. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Concatenated text of every scanned keymap-producer source file. */
function scanKeymapSource(): string {
  const parts: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collectSourceFiles(dir)) parts.push(readFileSync(file, "utf8"));
  }
  return parts.join("\n");
}

function extractIds(text: string, re: RegExp): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(re)) ids.add(m[1]);
  return ids;
}

const KEYMAP_TEXT = scanKeymapSource();

const getShortcutIds = extractIds(
  KEYMAP_TEXT,
  /getShortcut\(\s*["']([^"']+)["']\s*\)/g,
);
const runEditorActionIds = extractIds(
  KEYMAP_TEXT,
  /runEditorAction\(\s*["']([^"']+)["']/g,
);
const runCommandEditorIds = extractIds(
  KEYMAP_TEXT,
  /runCommand\(\s*["']editor\.([^"']+)["']/g,
);
const executeCommandIds = extractIds(
  KEYMAP_TEXT,
  /executeCommand\(\s*["']([^"']+)["']/g,
);

/**
 * Known hardcoded-chord bespoke handlers the gate guards. Each MUST be covered by
 * an APPROVED_MECHANICS row whose keys include the listed chord. Adding a new
 * bespoke chord to a keymap without an entry here (and in APPROVED_MECHANICS)
 * leaves it UNCLASSIFIED.
 */
const EXPECTED_BESPOKE: ReadonlyArray<{ id: string; chord: string }> = [
  { id: "wysiwyg.multiCursorSelectNext", chord: "Mod-d" },
  { id: "wysiwyg.multiCursorSelectAll", chord: "Mod-Shift-l" },
  { id: "wysiwyg.multiCursorEscape", chord: "Escape" },
  { id: "wysiwyg.tableCellForward", chord: "Tab" },
  { id: "wysiwyg.aiSuggestionRejectAll", chord: "Mod-Shift-Escape" },
  { id: "source.selectNextOccurrence", chord: "Mod-d" },
  { id: "source.selectAllOccurrences", chord: "Mod-Shift-l" },
  { id: "source.multiCursorEscape", chord: "Escape" },
];

/** Resolve a `runEditorAction` id to its registered command id (setHeading → .1). */
function editorActionCommandId(actionId: string): string {
  return actionId === "setHeading" ? "editor.setHeading.1" : `editor.${actionId}`;
}

beforeAll(() => {
  _resetCommandBus();
  // Register the full command surface the keymaps draw from.
  registerMiscCommands();
  registerViewCommands();
  registerBrowserCommands();
  registerTabCommands();
  registerFileCommands();
  registerGenieCommands();
  registerEditorCommands();
});

describe("mechanic-extraction gate — keymap ids are classified (WI-4.1)", () => {
  it("scan finds keymap source (guards a broken walk)", () => {
    expect(KEYMAP_TEXT.length).toBeGreaterThan(1000);
  });

  it("every getShortcut(id) in the keymaps is a rebindable DEFAULT_SHORTCUTS id", () => {
    expect(getShortcutIds.size).toBeGreaterThanOrEqual(30);
    const unknown = [...getShortcutIds].filter((id) => !shortcutIds.has(id));
    expect(
      unknown,
      `UNCLASSIFIED getShortcut ids (not in DEFAULT_SHORTCUTS): ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("every runEditorAction/runCommand/executeCommand id is a registered command", () => {
    const commandIds = new Set<string>();
    for (const a of runEditorActionIds) commandIds.add(editorActionCommandId(a));
    for (const c of runCommandEditorIds) commandIds.add(`editor.${c}`);
    for (const e of executeCommandIds) commandIds.add(e);

    expect(commandIds.size).toBeGreaterThanOrEqual(20);
    const unregistered = [...commandIds].filter((id) => !getCommand(id));
    expect(
      unregistered,
      `UNCLASSIFIED command ids (not registered on the CommandBus): ${unregistered.join(", ")}`,
    ).toEqual([]);
  });

  it("every known hardcoded-chord bespoke binding is an approved mechanic", () => {
    expect(APPROVED_MECHANICS.length).toBeGreaterThanOrEqual(10);
    const uncovered: string[] = [];
    for (const { id, chord } of EXPECTED_BESPOKE) {
      const mechanic = APPROVED_MECHANICS.find((m) => m.id === id);
      if (!mechanic) {
        uncovered.push(`${id} (no APPROVED_MECHANICS row)`);
      } else if (!mechanic.keys.includes(chord)) {
        uncovered.push(`${id} (chord "${chord}" not in [${mechanic.keys.join(", ")}])`);
      }
    }
    expect(
      uncovered,
      `UNCLASSIFIED bespoke bindings (missing from APPROVED_MECHANICS): ${uncovered.join("; ")}`,
    ).toEqual([]);
  });

  it("EXPECTED_BESPOKE ids are all real APPROVED_MECHANIC_IDS (no stale rows)", () => {
    for (const { id } of EXPECTED_BESPOKE) {
      expect(APPROVED_MECHANIC_IDS.has(id), `stale EXPECTED_BESPOKE id "${id}"`).toBe(true);
    }
  });
});
