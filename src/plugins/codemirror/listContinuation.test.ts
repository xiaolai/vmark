/**
 * Tests for listContinuation — smart list continuation in CodeMirror source mode.
 *
 * Tests the listContinuationKeymap Enter handler for:
 *   - Unordered list continuation (-, *, +)
 *   - Ordered list continuation with auto-increment (1., 2.)
 *   - Task list continuation with unchecked checkbox
 *   - Empty list item removal (exit list on Enter on empty bullet)
 *   - Multi-cursor bail-out
 *   - Range selection bail-out
 *   - Non-list line pass-through
 *   - Cursor before marker pass-through
 */

import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock imeGuard to run handlers directly
vi.mock("@/utils/imeGuard", () => ({
  guardCodeMirrorKeyBinding: (binding: { key: string; run: (view: EditorView) => boolean }) =>
    binding,
}));

import { listContinuationKeymap } from "./listContinuation";

function createView(content: string, cursorPos: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos },
  });
  const parent = document.createElement("div");
  return new EditorView({ state, parent });
}

function runEnter(view: EditorView): boolean {
  return listContinuationKeymap.run!(view);
}

describe("listContinuationKeymap", () => {
  describe("non-list lines", () => {
    it("returns false for plain text", () => {
      const view = createView("Hello world", 5);
      expect(runEnter(view)).toBe(false);
      view.destroy();
    });

    it("returns false for empty document", () => {
      const view = createView("", 0);
      expect(runEnter(view)).toBe(false);
      view.destroy();
    });

    it("returns false for heading line", () => {
      const view = createView("# Heading", 5);
      expect(runEnter(view)).toBe(false);
      view.destroy();
    });
  });

  describe("multi-cursor bail-out", () => {
    it("returns false when multiple selections are active", () => {
      // Simulate multiple ranges directly on the mock view
      const mockView = {
        state: {
          selection: {
            ranges: [{ from: 2, to: 2 }, { from: 5, to: 5 }],
            main: { from: 2, to: 2 },
          },
        },
      } as unknown as EditorView;
      expect(listContinuationKeymap.run!(mockView)).toBe(false);
    });
  });

  describe("range selection bail-out", () => {
    it("returns false when selection is a range (not collapsed)", () => {
      const state = EditorState.create({
        doc: "- item",
        selection: { anchor: 2, head: 5 },
      });
      const parent = document.createElement("div");
      const view = new EditorView({ state, parent });
      expect(runEnter(view)).toBe(false);
      view.destroy();
    });
  });

  describe("cursor before marker", () => {
    it("returns false when cursor is before the list marker", () => {
      // "- item" cursor at position 0 (before the dash)
      const view = createView("- item", 0);
      expect(runEnter(view)).toBe(false);
      view.destroy();
    });
  });

  describe("unordered list continuation", () => {
    it("continues unordered list with dash marker", () => {
      const view = createView("- item one", 10);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("- item one\n- ");
      view.destroy();
    });

    it("continues unordered list with asterisk marker", () => {
      const view = createView("* item", 6);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("* item\n* ");
      view.destroy();
    });

    it("continues unordered list with plus marker", () => {
      const view = createView("+ item", 6);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("+ item\n+ ");
      view.destroy();
    });

    it("preserves indentation on continuation", () => {
      const view = createView("  - nested item", 15);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("  - nested item\n  - ");
      view.destroy();
    });

    it("removes marker from empty unordered list item (exit list)", () => {
      const view = createView("- ", 2);
      expect(runEnter(view)).toBe(true);
      // Marker should be removed, leaving just empty indent region
      const doc = view.state.doc.toString();
      expect(doc).not.toContain("- ");
      view.destroy();
    });
  });

  describe("ordered list continuation", () => {
    it("continues ordered list and auto-increments number (dot suffix)", () => {
      const view = createView("1. item", 7);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("1. item\n2. ");
      view.destroy();
    });

    it("continues ordered list with parenthesis suffix", () => {
      const view = createView("1) item", 7);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("1) item\n2) ");
      view.destroy();
    });

    it("auto-increments from arbitrary number", () => {
      const view = createView("5. item", 7);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("5. item\n6. ");
      view.destroy();
    });

    it("removes marker from empty ordered list item (exit list)", () => {
      const view = createView("1. ", 3);
      expect(runEnter(view)).toBe(true);
      const doc = view.state.doc.toString();
      expect(doc).not.toContain("1. ");
      view.destroy();
    });
  });

  describe("task list continuation", () => {
    it("continues checked task with unchecked checkbox", () => {
      const view = createView("- [x] done item", 15);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("- [x] done item\n- [ ] ");
      view.destroy();
    });

    it("continues unchecked task with unchecked checkbox", () => {
      const view = createView("- [ ] todo item", 15);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("- [ ] todo item\n- [ ] ");
      view.destroy();
    });

    it("continues task list using asterisk marker", () => {
      const view = createView("* [ ] task", 10);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("* [ ] task\n* [ ] ");
      view.destroy();
    });

    it("removes marker from empty task list item (exit list)", () => {
      const view = createView("- [ ] ", 6);
      expect(runEnter(view)).toBe(true);
      const doc = view.state.doc.toString();
      expect(doc).not.toContain("- [ ] ");
      view.destroy();
    });

    it("preserves indentation on task list continuation", () => {
      const view = createView("  - [X] done", 12);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("  - [X] done\n  - [ ] ");
      view.destroy();
    });
  });

  describe("cursor placement after continuation", () => {
    it("places cursor after new marker on unordered list", () => {
      const view = createView("- item", 6);
      expect(runEnter(view)).toBe(true);
      // cursor should be after "- item\n- " (position 9)
      expect(view.state.selection.main.from).toBe(9);
      view.destroy();
    });

    it("places cursor after new marker on ordered list", () => {
      const view = createView("1. item", 7);
      expect(runEnter(view)).toBe(true);
      // cursor after "1. item\n2. " = 7 + 1 + 3 = 11
      expect(view.state.selection.main.from).toBe(11);
      view.destroy();
    });

    it("places cursor at markerStart when exiting empty unordered item", () => {
      const view = createView("- ", 2);
      expect(runEnter(view)).toBe(true);
      // Cursor should be at position 0 (start of line, marker removed)
      expect(view.state.selection.main.from).toBe(0);
      view.destroy();
    });
  });

  describe("fenced code blocks", () => {
    it("returns false when cursor is inside a fenced code block on a list-shaped line", () => {
      // Doc: ```python\n- for x in items:\n```
      const doc = "```python\n- for x in items:\n```";
      // Place cursor at end of "- for x in items:" line
      const cursorPos = "```python\n- for x in items:".length;
      const view = createView(doc, cursorPos);
      const before = view.state.doc.toString();
      expect(runEnter(view)).toBe(false);
      // No dispatch occurred — document is unchanged
      expect(view.state.doc.toString()).toBe(before);
      view.destroy();
    });

    it("still continues a real list outside fences", () => {
      // Doc: - item\n```\n```
      const doc = "- item\n```\n```";
      // Cursor at end of "- item"
      const view = createView(doc, "- item".length);
      expect(runEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("- item\n- \n```\n```");
      view.destroy();
    });
  });

  describe("keymap structure", () => {
    it("is bound to Enter key", () => {
      expect(listContinuationKeymap.key).toBe("Enter");
    });

    it("has a run function", () => {
      expect(typeof listContinuationKeymap.run).toBe("function");
    });
  });
});
