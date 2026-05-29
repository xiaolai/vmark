/**
 * Tests for Tab Indent Plugin
 *
 * Tests Tab and Shift-Tab key handlers for indentation.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/utils/imeGuard", () => ({
  guardCodeMirrorKeyBinding: (binding: unknown) => binding,
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      general: { tabSize: 4 },
    }),
  },
}));

import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  tabIndentFallbackKeymap,
  shiftTabIndentFallbackKeymap,
} from "./tabIndent";

const multiCursorExtension = EditorState.allowMultipleSelections.of(true);
const views: EditorView[] = [];

afterEach(() => {
  views.forEach((v) => v.destroy());
  views.length = 0;
});

function createView(content: string, anchor: number, head?: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor, head: head ?? anchor },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  views.push(view);
  return view;
}

function createMultiCursorView(
  content: string,
  positions: number[]
): EditorView {
  const ranges = positions.map((p) => EditorSelection.cursor(p));
  const state = EditorState.create({
    doc: content,
    selection: EditorSelection.create(ranges, 0),
    extensions: [multiCursorExtension],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  views.push(view);
  return view;
}

describe("tabIndentFallbackKeymap", () => {
  it("has key set to Tab", () => {
    expect(tabIndentFallbackKeymap.key).toBe("Tab");
  });

  it("inserts spaces at cursor position", () => {
    const view = createView("hello", 5);
    const result = tabIndentFallbackKeymap.run!(view);

    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello    ");
  });

  it("inserts 4 spaces (default tab size)", () => {
    const view = createView("hello", 0);
    tabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("    hello");
  });

  it("replaces selected text with spaces", () => {
    const view = createView("hello world", 0, 5);
    tabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("     world");
  });

  it("places cursor after inserted spaces", () => {
    const view = createView("hello", 0);
    tabIndentFallbackKeymap.run!(view);

    expect(view.state.selection.main.anchor).toBe(4);
  });

  it("handles empty document", () => {
    const view = createView("", 0);
    tabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("    ");
  });

  it("handles cursor at end of document", () => {
    const view = createView("hello", 5);
    tabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("hello    ");
  });

  it("handles multi-cursor: inserts spaces at all cursors", () => {
    const view = createMultiCursorView("hello\nworld", [0, 6]);
    tabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("    hello\n    world");
  });

  it("handles multi-cursor: adjusts positions for prior insertions", () => {
    const view = createMultiCursorView("ab", [0, 1]);
    tabIndentFallbackKeymap.run!(view);

    // First cursor at 0 inserts 4 spaces -> "    ab"
    // Second cursor was at 1, shifted by 4 -> now at 5, inserts 4 spaces -> "    a    b"
    expect(view.state.doc.toString()).toBe("    a    b");
  });

  it("always returns true", () => {
    const view = createView("hello", 0);
    expect(tabIndentFallbackKeymap.run!(view)).toBe(true);
  });
});

describe("shiftTabIndentFallbackKeymap", () => {
  it("has key set to Shift-Tab", () => {
    expect(shiftTabIndentFallbackKeymap.key).toBe("Shift-Tab");
  });

  it("removes leading spaces from line", () => {
    const view = createView("    hello", 9);
    shiftTabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("hello");
  });

  it("removes up to tabSize spaces", () => {
    const view = createView("        hello", 13);
    shiftTabIndentFallbackKeymap.run!(view);

    // Should remove 4 spaces (tabSize), leaving 4
    expect(view.state.doc.toString()).toBe("    hello");
  });

  it("removes fewer spaces if less than tabSize available", () => {
    const view = createView("  hello", 7);
    shiftTabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("hello");
  });

  it("does nothing when no leading spaces", () => {
    const view = createView("hello", 5);
    shiftTabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("hello");
  });

  it("handles empty document", () => {
    const view = createView("", 0);
    shiftTabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("");
  });

  it("always returns true (prevents focus leaving)", () => {
    const view = createView("hello", 0);
    expect(shiftTabIndentFallbackKeymap.run!(view)).toBe(true);
  });

  it("handles multi-cursor: outdents all cursor lines", () => {
    const view = createMultiCursorView("    hello\n    world", [4, 14]);
    shiftTabIndentFallbackKeymap.run!(view);

    // Both cursors are on indented lines, so both get outdented
    expect(view.state.doc.toString()).toBe("hello\nworld");
  });

  it("does nothing when cursor is at beginning of indented line", () => {
    const view = createView("    hello", 0);
    shiftTabIndentFallbackKeymap.run!(view);

    // Cursor at pos 0, line starts at 0, textBefore is empty string
    // leadingSpaces = 0, so no change is made
    expect(view.state.doc.toString()).toBe("    hello");
  });

  it("handles line with only spaces", () => {
    const view = createView("    ", 4);
    shiftTabIndentFallbackKeymap.run!(view);

    expect(view.state.doc.toString()).toBe("");
  });

  it("handles mixed indentation with cursor mid-line", () => {
    const view = createView("    hello world", 8);
    shiftTabIndentFallbackKeymap.run!(view);

    // Cursor at pos 8, which is after "    hell", textBefore is "    hell"
    // leadingSpaces = 4, removes 4
    expect(view.state.doc.toString()).toBe("hello world");
  });

  it("outdents once (no overlapping-change crash) with two cursors on one line (#961)", () => {
    // Two cursors at different offsets on the same indented line.
    const view = createMultiCursorView("        code", [8, 12]);
    expect(() => shiftTabIndentFallbackKeymap.run!(view)).not.toThrow();
    // A single outdent of tabSize (4) — not two stacked removals.
    expect(view.state.doc.toString()).toBe("    code");
  });
});
