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
 * Direct (non-executor) handlers this module may keep, each with the reason it
 * is not a document mutation. Adding an entry is a claim about the shortcut's
 * nature, not a way to silence the gate.
 */
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
