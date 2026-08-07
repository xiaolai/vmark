// @vitest-environment node
/**
 * Reverse-closure gate for the keybinding system (ADR-018 integrity, dual of the
 * forward manifest/drift gate).
 *
 * The forward gate proves KEYBINDINGS → a registered command + a real chord. This
 * test proves the OTHER direction: every `DEFAULT_SHORTCUTS` entry (the rows the
 * Shortcuts settings UI renders as rebindable) actually has a runtime consumer. A
 * definition is "consumed" when ANY of:
 *   1. it carries a `menuId` (a native menu accelerator drives it), OR
 *   2. its `id` is a `shortcutId` in `KEYBINDINGS` (the registry routes it), OR
 *   3. its `id` is read via `getShortcut("<id>")` somewhere in `src` (an editor
 *      keymap builder — editorPlugins/sourceShortcuts — or a component/hook such
 *      as `useUniversalToolbar` binds it live).
 *
 * Consumer class 3 is detected by a deterministic SOURCE SCAN (not by executing
 * the keymaps): we read every non-test `.ts`/`.tsx` under `src` and regex-extract
 * `getShortcut("id")` literals. The scan spans the whole tree ON PURPOSE — some
 * definitions (e.g. `formatToolbar`) are consumed only through a component/hook
 * `getShortcut` call, so restricting the scan to the three keymap files would
 * mislabel a genuinely-live binding as dead.
 *
 * A definition that satisfies none of the three is DEAD: rebindable-looking in
 * Settings but ignored at runtime. `KNOWN_UNBOUND` is the tight, hand-curated
 * allowlist of the current dead set. The test asserts SET EQUALITY, so it FAILS
 * if a new unconsumed definition is added OR if a listed one becomes consumed —
 * forcing a conscious "wire it through `getShortcut` / KEYBINDINGS, or remove it"
 * decision instead of letting dead rows accumulate silently.
 *
 * KNOWN_UNBOUND is now EMPTY: the debt is fully paid down. The four multi-cursor
 * commands whose chords were previously HARDCODED in
 * `src/plugins/multiCursor/keymap.ts` (addCursorAbove, addCursorBelow,
 * skipOccurrence, softUndoCursor) now resolve their chords via `getShortcut`
 * (consumer class 3), so their Settings rows rebind live. The gate therefore
 * asserts ZERO dead definitions — every DEFAULT_SHORTCUTS row has a consumer.
 *
 * Paying down an entry = route its chord through `getShortcut` (or KEYBINDINGS)
 * and delete it here; the equality assertion then keeps the debt list honest.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";
import { KEYBINDINGS } from "./keybindingDefinitions";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", ".."); // .../src

/** Curated dead set — see the module header for the debt rationale. */
const KNOWN_UNBOUND = [] as const;

/** Collect every non-test `.ts`/`.tsx` file under `dir`. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.test\.|\.spec\./.test(entry)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** All `getShortcut("id")` literal ids referenced anywhere in the src tree. */
function collectGetShortcutIds(): Set<string> {
  const ids = new Set<string>();
  const re = /getShortcut\(\s*["']([^"']+)["']\s*\)/g;
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(re)) ids.add(match[1]);
  }
  return ids;
}

function computeConsumedIds(): Set<string> {
  const consumed = new Set<string>();
  // Class 1: native menu accelerator.
  for (const def of DEFAULT_SHORTCUTS) {
    if (def.menuId) consumed.add(def.id);
  }
  // Class 2: registry binding.
  for (const binding of KEYBINDINGS) {
    if ("shortcutId" in binding) consumed.add(binding.shortcutId);
  }
  // Class 3: live getShortcut() read (whole-tree source scan).
  for (const id of collectGetShortcutIds()) consumed.add(id);
  return consumed;
}

function computeUnconsumedIds(): string[] {
  const consumed = computeConsumedIds();
  return DEFAULT_SHORTCUTS.filter((d) => !consumed.has(d.id)).map((d) => d.id);
}

describe("shortcut consumer reverse-closure gate", () => {
  it("every DEFAULT_SHORTCUTS entry has a consumer except the KNOWN_UNBOUND debt", () => {
    const unconsumed = computeUnconsumedIds();
    // Set equality: no NEW dead entry, and no listed entry silently became live.
    expect(new Set(unconsumed)).toEqual(new Set(KNOWN_UNBOUND));
  });

  it("KNOWN_UNBOUND lists only real DEFAULT_SHORTCUTS ids (no stale allowlist rows)", () => {
    const allIds = new Set(DEFAULT_SHORTCUTS.map((d) => d.id));
    for (const id of KNOWN_UNBOUND) expect(allIds.has(id)).toBe(true);
  });

  it("KNOWN_UNBOUND is duplicate-free", () => {
    expect(new Set(KNOWN_UNBOUND).size).toBe(KNOWN_UNBOUND.length);
  });

  it("the source scan actually finds getShortcut references (guards a broken scan)", () => {
    // If the regex/walk silently matched nothing, the consumed set would collapse
    // and the equality assertion would over-report dead entries. Sanity-floor it.
    expect(collectGetShortcutIds().size).toBeGreaterThan(20);
  });
});
