/**
 * WI-2.1 — the dispatch boundary, as a gate rather than a hand-count.
 *
 * Source-mode shortcuts route document mutations through `runEditorAction`,
 * the same executor the native menu uses, so a keystroke and a menu click
 * produce identical output with identical gates (format policy, capability,
 * unified undo, IME safety). A shortcut that calls an adapter action function
 * directly bypasses all of it.
 *
 * Enumerating the bypasses by hand is how revision 3 of the plan came to
 * describe a state the code had already left. This inverts the burden: the
 * PERMITTED direct handlers are listed, and any new one fails here until it is
 * either routed or added with a reason.
 *
 * Not every shortcut belongs on the executor. View and search commands, copy,
 * comment-toggle, selection and smart-select are not document operations —
 * routing them through the action dispatcher would be wrong, not thorough.
 *
 * @coordinates-with plugins/codemirror/sourceShortcuts.ts — the module under gate
 * @coordinates-with services/editor/runEditorAction.ts — the executor
 * @module plugins/codemirror/__tests__/dispatchBoundary.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHORTCUTS = join(__dirname, "../sourceShortcuts.ts");
const source = readFileSync(SHORTCUTS, "utf8");

/**
 * Shortcut IDs whose handlers are NOT document mutations, with the reason.
 *
 * Enumerated by shortcut ID rather than by helper name, because a handler can
 * reach a mutation through any import — which is exactly how
 * `toggleBlockComment` walked past the first version of this gate, which only
 * looked for `runSourceAction(` and the helper import list.
 */
const NON_MUTATING = new Map<string, string>([
  ["toggleSidebar", "UI panel visibility — touches no document"],
  ["sourceMode", "returns true to mark handled; useViewShortcuts does the toggle"],
  ["selectLine", "selection only"],
  ["findReplace", "opens the search panel"],
  ["findNext", "search navigation — moves the selection only"],
  ["findPrevious", "search navigation — moves the selection only"],
  ["copyAsHTML", "clipboard export — reads the document, never writes"],
]);

/**
 * Document mutations that are DECIDED exceptions, not oversights.
 *
 * WI-2.1 requires a bypass to reach the action system, or the executor gap to
 * be closed, or the binding to be recorded here with its reason. `unlink` took
 * the second route — both adapters already implemented it and only the
 * `ActionId` was missing. `toggleComment` cannot: NO adapter implements a
 * comment toggle on either surface, so closing it means designing the action
 * and implementing it twice, which is feature work rather than an audit fix.
 *
 * The cost of leaving it is real and stated: the shortcut skips the executor's
 * format and capability gates, unified cross-mode undo, and IME-safe dispatch,
 * so Mod-/ in Source mode does not behave identically to the same action
 * invoked elsewhere — and there is nowhere else to invoke it from.
 */
/**
 * Keys bound by a direct `bindings.push`, outside `bindIfKey`.
 *
 * They are not shortcut-store driven, so `bindIfKey`'s enumeration never saw
 * them — an independent verification pointed out the gate was measuring 62 of
 * 64 bindings and calling that complete.
 */
const DIRECT_PUSH_NON_MUTATING = new Map<string, string>([
  ["Mod-a", "select-all expansion — selection only, no document change"],
  ["Mod-z", "restores the previous selection after a smart select-all"],
]);

const DECIDED_MUTATION_EXCEPTIONS = new Map<string, string>([
  [
    "toggleComment",
    "no comment action exists on either adapter; closing the gap is feature " +
      "work, not a fix. Skips executor gates, unified undo and IME safety.",
  ],
]);

const PERMITTED_DIRECT = new Map<string, string>([
  ["openFindBar", "search UI — opens a panel, mutates no document"],
  ["findNextMatch", "search navigation — moves the selection only"],
  ["findPreviousMatch", "search navigation — moves the selection only"],
  ["copySelectionAsHtml", "clipboard export — reads the document, never writes"],
]);

/** Every `runSourceAction("…")` call site — the adapter-bypass form. */
function directAdapterCalls(): string[] {
  return [...source.matchAll(/runSourceAction\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** Every helper imported from sourceShortcutsHelpers. */
function importedHelpers(): string[] {
  const block = source.match(
    /import\s*\{([^}]*)\}\s*from\s*"\.\/sourceShortcutsHelpers"/
  );
  if (!block) return [];
  return block[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("no document mutation bypasses the executor", () => {
  it("makes no direct adapter call for a document action", () => {
    // `runSourceAction` reaches the source adapter without the executor's
    // format/capability gates, unified undo, or IME safety. `unlink` was the
    // last one; it now has an `editor.unlink` action like every sibling.
    expect(directAdapterCalls()).toEqual([]);
  });

  it("imports only permitted non-mutating helpers", () => {
    const unexplained = importedHelpers().filter(
      (name) => name !== "runSourceAction" && !PERMITTED_DIRECT.has(name)
    );
    expect(unexplained).toEqual([]);
  });

  it("every permitted direct handler still has a stated reason", () => {
    // A stale exemption is its own defect: the entry claims the shortcut is
    // not a document operation, and that claim must stay true and used.
    const imported = new Set(importedHelpers());
    const dead = [...PERMITTED_DIRECT.keys()].filter((name) => !imported.has(name));
    expect(dead).toEqual([]);
  });
});

describe("EVERY binding is accounted for", () => {
  /** Each `bindIfKey(...)` shortcut id paired with its handler expression. */
  function bindings(): { id: string; handler: string }[] {
    return [
      ...source.matchAll(
        /bindIfKey\(\s*bindings,\s*shortcuts\.getShortcut\("([^"]+)"\),\s*([\s\S]*?)\);\n/g
      ),
    ].map((m) => ({ id: m[1], handler: m[2].trim() }));
  }

  it("captures EVERY bindIfKey call — a regex that misses one proves nothing", () => {
    // `> 30` would pass while silently skipping a binding written in a shape
    // the pattern does not match, which is the same failure this gate exists
    // to catch. Counting call sites independently makes the gate check itself:
    // the only non-call occurrence of the identifier is its own definition.
    // Tolerates `bindIfKey (` with a space, which both the capture regex and a
    // naive `split("bindIfKey(")` would have missed in the same direction —
    // agreeing with each other while missing a binding.
    const occurrences = (source.match(/\bbindIfKey\s*\(/g) ?? []).length;
    const definition = 1;
    expect(bindings().length).toBe(occurrences - definition);
  });

  it("routes every binding through runCommand, or names it as non-mutating", () => {
    // The earlier gate looked only for `runSourceAction(` and the helper
    // imports, so a direct mutation reached through a DIFFERENT import walked
    // straight past it — `toggleBlockComment` did exactly that. Enumerating
    // the bindings closes the class, not the instance.
    const unaccounted = bindings().filter(
      ({ id, handler }) =>
        !handler.startsWith("runCommand(") &&
        !NON_MUTATING.has(id) &&
        !DECIDED_MUTATION_EXCEPTIONS.has(id)
    );

    expect(unaccounted.map((b) => `${b.id}: ${b.handler.slice(0, 40)}`)).toEqual([]);
  });

  it("accounts for DIRECT bindings.push sites too — they bypassed the gate", () => {
    // Two key bindings (`Mod-a`, `Mod-z`) are pushed directly rather than via
    // bindIfKey, so enumerating bindIfKey alone left them outside the boundary
    // entirely. Both are selection-only; the gate now says so and fails if a
    // third appears without a decision.
    const pushes = [
      ...source.matchAll(/bindings\.push\(\s*guardCodeMirrorKeyBinding\(\{\s*key: "([^"]+)"/g),
    ].map((m) => m[1]);

    expect(pushes.sort()).toEqual(["Mod-a", "Mod-z"]);
    for (const key of pushes) expect(DIRECT_PUSH_NON_MUTATING.has(key)).toBe(true);
  });

  it("every exemption is still bound — a stale one describes nothing", () => {
    const bound = new Set(bindings().map((b) => b.id));
    const stale = [...NON_MUTATING.keys(), ...DECIDED_MUTATION_EXCEPTIONS.keys()].filter(
      (id) => !bound.has(id)
    );
    expect(stale).toEqual([]);
  });

  it("keeps the decided-exception list SHORT — one, and it is named", () => {
    // Not a budget for convenience: each entry is a shortcut that behaves
    // differently from every other invocation of the same operation.
    expect([...DECIDED_MUTATION_EXCEPTIONS.keys()]).toEqual(["toggleComment"]);
  });
});

describe("the executor is reached the same way for every mutation", () => {
  it("routes formatting through runEditorAction, not executeCommand", () => {
    // executeCommand's stricter palette gate drops keyboard formatting (WI-4.2).
    expect(source).toContain("runEditorAction");
    expect(source).not.toMatch(/\bexecuteCommand\(/);
  });

  it("binds unlink through the action system like its siblings", () => {
    expect(source).toContain('runCommand("editor.unlink")');
  });
});
