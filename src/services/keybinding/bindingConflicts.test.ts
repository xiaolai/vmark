/**
 * WI-1.4 — scope-aware conflict model. Unit-tests `detectConflicts` (same
 * chord + owner + scope + priority = potential ambiguity; cross-scope /
 * cross-owner / distinct-priority coexist), and asserts the SHIPPED KEYBINDINGS
 * set is conflict-free under the default shortcut resolution.
 */

import { describe, expect, it } from "vitest";
import { buildIndex, detectConflicts, type Binding } from "./bindingRegistry";
import { KEYBINDINGS } from "./keybindingDefinitions";
import { resolveShortcutChord } from "./keybindingRegistry";

function cmd(overrides: Partial<Binding> & { fixedChord: string }): Binding {
  return {
    kind: "command",
    commandId: "test.cmd",
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
    ...overrides,
  } as Binding;
}

describe("detectConflicts (WI-1.4)", () => {
  it("flags two bindings sharing chord + owner + scope + priority", () => {
    const index = buildIndex(
      [cmd({ fixedChord: "meta+KeyK" }), cmd({ fixedChord: "meta+KeyK" })],
      () => null,
    );
    const conflicts = detectConflicts(index);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ chord: "meta+KeyK", count: 2 });
  });

  it("does NOT flag same chord across DIFFERENT scopes (specificity decides)", () => {
    const index = buildIndex(
      [cmd({ fixedChord: "meta+KeyK", scope: "window" }), cmd({ fixedChord: "meta+KeyK", scope: "modal" })],
      () => null,
    );
    expect(detectConflicts(index)).toEqual([]);
  });

  it("FLAGS same chord across distinct scopes of EQUAL specificity (audit-fix #4)", () => {
    // editor-wysiwyg and editor-source both have specificity 40 — they would TIE at
    // resolve time (AmbiguousBindingError) if a context ever carried both, so the
    // conflict must be reported even though the scope NAMES differ.
    const index = buildIndex(
      [
        cmd({ fixedChord: "meta+KeyK", scope: "editor-wysiwyg" }),
        cmd({ fixedChord: "meta+KeyK", scope: "editor-source" }),
      ],
      () => null,
    );
    expect(detectConflicts(index)).toHaveLength(1);
  });

  it("does NOT flag same chord/scope with DISTINCT priorities", () => {
    const index = buildIndex(
      [cmd({ fixedChord: "meta+KeyK", priority: 0 }), cmd({ fixedChord: "meta+KeyK", priority: 1 })],
      () => null,
    );
    expect(detectConflicts(index)).toEqual([]);
  });

  it("does NOT flag same chord across DIFFERENT capture owners", () => {
    const index = buildIndex(
      [cmd({ fixedChord: "meta+KeyK", captureOwner: "window" }), cmd({ fixedChord: "meta+KeyK", captureOwner: "editor-wysiwyg" })],
      () => null,
    );
    expect(detectConflicts(index)).toEqual([]);
  });

  it("returns [] for an empty / single-binding index", () => {
    expect(detectConflicts(buildIndex([], () => null))).toEqual([]);
    expect(detectConflicts(buildIndex([cmd({ fixedChord: "meta+KeyK" })], () => null))).toEqual([]);
  });
});

describe("KEYBINDINGS — no conflicts under default resolution (WI-1.4)", () => {
  it("the shipped binding set has no same-owner/scope/priority chord collisions", () => {
    const index = buildIndex(KEYBINDINGS, resolveShortcutChord);
    const conflicts = detectConflicts(index);
    const describe = conflicts
      .map((c) => `${c.chord} (${c.captureOwner}/${c.scope}/p${c.priority}) ×${c.count}`)
      .join("; ");
    expect(conflicts, `conflicts: ${describe}`).toEqual([]);
  });
});
