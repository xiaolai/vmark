/**
 * Tests for sourceMathPreview — math popup plugin behavior.
 *
 * Tests the SourceMathPreviewPlugin with the editable popup:
 * - Opens popup when cursor is inside inline math ($...$)
 * - Opens popup when cursor is inside block math ($$...$$)
 * - Does not open popup when cursor is outside math
 * - Does not open popup for range selection
 * - Block math takes priority over inline math
 * - Rechecks on document/selection change
 * - Destroy cleans up
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const mockFindInlineMath = vi.fn(() => null as { from: number; to: number; content: string } | null);
const mockFindBlockMath = vi.fn(() => null as { from: number; to: number; content: string } | null);

vi.mock("@/plugins/toolbarActions/sourceMathActions", () => ({
  findInlineMathAtCursor: (...args: unknown[]) => mockFindInlineMath(...args),
  findBlockMathAtCursor: (...args: unknown[]) => mockFindBlockMath(...args),
}));

vi.mock("@/plugins/sourceMathPopup/SourceMathPopupView", () => ({
  SourceMathPopupView: class MockSourceMathPopupView {
    destroy() { /* no-op */ }
  },
}));

import { createSourceMathPreviewPlugin } from "../sourceMathPreview";
import { useSourceMathPopupStore } from "@/stores/sourceMathPopupStore";

async function flushRaf(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(r));
}

function createView(content: string, cursorPos: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos },
    extensions: [createSourceMathPreviewPlugin(useSourceMathPopupStore)],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

const createdViews: EditorView[] = [];

function tracked(content: string, cursorPos: number): EditorView {
  const v = createView(content, cursorPos);
  createdViews.push(v);
  return v;
}

describe("sourceMathPreview", () => {
  let coordsSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    coordsSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      top: 100,
      left: 50,
      bottom: 120,
      right: 200,
    });
  });

  afterAll(() => {
    coordsSpy.mockRestore();
  });

  beforeEach(() => {
    mockFindInlineMath.mockClear();
    mockFindBlockMath.mockClear();
    mockFindInlineMath.mockReturnValue(null);
    mockFindBlockMath.mockReturnValue(null);
    coordsSpy.mockClear();
    useSourceMathPopupStore.getState().closePopup();
  });

  afterEach(() => {
    createdViews.forEach((v) => v.destroy());
    createdViews.length = 0;
    useSourceMathPopupStore.getState().closePopup();
  });

  describe("inline math popup", () => {
    it("opens popup when cursor is inside inline math", async () => {
      mockFindInlineMath.mockReturnValue({ from: 0, to: 11, content: "x^2 + 1" });
      tracked("$x^2 + 1$", 3);
      await flushRaf();

      const state = useSourceMathPopupStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.latex).toBe("x^2 + 1");
      expect(state.isBlock).toBe(false);
    });

    it("does not re-open popup while already open", async () => {
      mockFindInlineMath.mockReturnValue({ from: 0, to: 11, content: "x^2" });
      const view = tracked("$x^2$", 3);
      await flushRaf();

      expect(useSourceMathPopupStore.getState().isOpen).toBe(true);

      // Move cursor — should not recheck while popup is open
      mockFindInlineMath.mockClear();
      view.dispatch({ selection: { anchor: 2 } });
      await flushRaf();

      // findInlineMath should NOT have been called again
      expect(mockFindInlineMath).not.toHaveBeenCalled();
    });
  });

  describe("block math popup", () => {
    it("opens popup when cursor is inside block math", async () => {
      const content = "$$\nE = mc^2\n$$";
      mockFindBlockMath.mockReturnValue({ from: 0, to: content.length, content: "E = mc^2" });
      tracked(content, 5);
      await flushRaf();

      const state = useSourceMathPopupStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.latex).toBe("E = mc^2");
      expect(state.isBlock).toBe(true);
    });

    it("block math takes priority over inline math", async () => {
      const content = "$$\nblock\n$$";
      mockFindBlockMath.mockReturnValue({ from: 0, to: content.length, content: "block" });
      mockFindInlineMath.mockReturnValue({ from: 0, to: 10, content: "inline" });
      tracked(content, 5);
      await flushRaf();

      expect(useSourceMathPopupStore.getState().latex).toBe("block");
    });
  });

  describe("no popup", () => {
    it("does not open popup when cursor is outside math", async () => {
      mockFindInlineMath.mockReturnValue(null);
      mockFindBlockMath.mockReturnValue(null);
      tracked("Hello world", 3);
      await flushRaf();

      expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
    });

    it("does not open popup for range selection (not collapsed cursor)", async () => {
      mockFindInlineMath.mockReturnValue({ from: 0, to: 10, content: "x" });
      const state = EditorState.create({
        doc: "$x$",
        selection: { anchor: 0, head: 3 },
        extensions: [createSourceMathPreviewPlugin(useSourceMathPopupStore)],
      });
      const view = new EditorView({ state, parent: document.createElement("div") });
      createdViews.push(view);
      await flushRaf();

      expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
    });
  });

  describe("no coordinates available", () => {
    it("does not open popup when coordsAtPos returns null", async () => {
      mockFindInlineMath.mockReturnValue({ from: 0, to: 10, content: "x" });
      coordsSpy.mockReturnValue(null);
      tracked("$x$", 2);
      await flushRaf();

      expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
    });
  });

  describe("update triggers", () => {
    it("rechecks on document change", async () => {
      mockFindInlineMath.mockReturnValue(null);
      const view = tracked("Hello", 0);
      await flushRaf();
      mockFindInlineMath.mockClear();
      mockFindBlockMath.mockClear();

      mockFindInlineMath.mockReturnValue({ from: 0, to: 5, content: "x" });
      view.dispatch({ changes: { from: 0, to: 5, insert: "$x$" } });
      await flushRaf();

      expect(mockFindBlockMath).toHaveBeenCalled();
    });

    it("rechecks on selection change", async () => {
      mockFindInlineMath.mockReturnValue(null);
      const view = tracked("$x$ hello", 7);
      await flushRaf();
      mockFindBlockMath.mockClear();

      view.dispatch({ selection: { anchor: 2 } });
      await flushRaf();

      expect(mockFindBlockMath).toHaveBeenCalled();
    });
  });

  describe("plugin extensions", () => {
    it("returns an array of extensions", () => {
      const extensions = createSourceMathPreviewPlugin(useSourceMathPopupStore);
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
    });
  });

  describe("destroy", () => {
    it("does not throw on destroy", () => {
      const view = tracked("$x$", 2);
      expect(() => view.destroy()).not.toThrow();
      createdViews.length = 0;
    });
  });
});
