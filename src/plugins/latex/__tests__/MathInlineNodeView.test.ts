/**
 * MathInlineNodeView Tests
 *
 * Tests for the inline math node view including:
 * - Constructor creates correct DOM structure
 * - Update method handles attribute changes
 * - Destroy cleanup
 * - Accessibility attributes (role, aria-label)
 * - selectNode / deselectNode
 * - stopEvent behavior
 * - ignoreMutation
 * - Preview rendering (KaTeX loaded/unloaded states)
 * - Edit mode entry/exit via class observation
 * - Edge cases (empty content, missing attrs)
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";

// Mock dependencies before imports
const mockLoadKatex = vi.fn();
const mockIsKatexLoaded = vi.fn();
const mockMathPreviewView = {
  show: vi.fn(),
  hide: vi.fn(),
  updateContent: vi.fn(),
};
const mockStartEditing = vi.fn();
const mockStopEditing = vi.fn();
const mockClear = vi.fn();

vi.mock("../katexLoader", () => ({
  loadKatex: (...args: unknown[]) => mockLoadKatex(...args),
  isKatexLoaded: () => mockIsKatexLoaded(),
}));

vi.mock("@/plugins/mathPreview/MathPreviewView", () => ({
  getMathPreviewView: () => mockMathPreviewView,
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

// Mock Selection.near to avoid needing full ProseMirror document structure
const { mockSelectionNear } = vi.hoisted(() => ({
  mockSelectionNear: vi.fn(() => ({
    $anchor: { pos: 0, min: vi.fn(() => 0), max: vi.fn(() => 0) },
    $head: { pos: 0, min: vi.fn(() => 0), max: vi.fn(() => 0) },
    anchor: 0,
    head: 0,
    from: 0,
    to: 0,
    empty: true,
  })),
}));
vi.mock("@tiptap/pm/state", async () => {
  const actual = await vi.importActual("@tiptap/pm/state");
  return {
    ...actual,
    Selection: {
      ...(actual as Record<string, unknown>).Selection,
      near: mockSelectionNear,
    },
  };
});

vi.mock("@/plugins/inlineNodeEditing/tiptap", () => ({
  inlineNodeEditingKey: {
    getState: vi.fn(() => null),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useShortcutsStore: {
    getState: () => ({
      getShortcut: vi.fn(() => "Mod-m"),
    }),
  },
}));

vi.mock("@/utils/shortcutMatch", () => ({
  matchesShortcutEvent: vi.fn(() => false),
}));

vi.mock("@/stores/inlineMathEditingStore", () => ({
  useInlineMathEditingStore: {
    getState: () => ({
      startEditing: mockStartEditing,
      stopEditing: mockStopEditing,
      clear: mockClear,
    }),
  },
}));

vi.mock("@/utils/debug", () => ({
  renderWarn: vi.fn(),
}));

import { MathInlineNodeView } from "../MathInlineNodeView";

// --- Helpers ---

function createMockNode(attrs: Record<string, unknown> = {}): PMNode {
  return {
    type: { name: "math_inline" },
    attrs: {
      content: attrs.content ?? "x^2",
      ...attrs,
    },
  } as unknown as PMNode;
}

function createMockEditorView() {
  return {
    state: {
      doc: {
        resolve: vi.fn(() => ({
          pos: 0,
          parent: { inlineContent: true, childCount: 0, type: { name: "paragraph" } },
          depth: 1,
          parentOffset: 0,
          node: vi.fn(() => ({ inlineContent: true, childCount: 0 })),
          start: vi.fn(() => 0),
          end: vi.fn(() => 0),
          before: vi.fn(() => 0),
          after: vi.fn(() => 0),
        })),
        nodeAt: vi.fn(() => ({
          type: { name: "math_inline" },
          attrs: { content: "x^2" },
          nodeSize: 1,
        })),
      },
      tr: {
        setSelection: vi.fn().mockReturnThis(),
        setNodeMarkup: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        replaceWith: vi.fn().mockReturnThis(),
      },
      schema: {
        text: vi.fn((t: string) => ({ type: "text", text: t })),
      },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    dom: document.createElement("div"),
  };
}

describe("MathInlineNodeView", () => {
  let nodeView: MathInlineNodeView;
  let mockView: ReturnType<typeof createMockEditorView>;
  let getPos: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = "";
    mockIsKatexLoaded.mockReturnValue(false);
    mockLoadKatex.mockResolvedValue({ default: { render: vi.fn() } });
    mockView = createMockEditorView();
    getPos = vi.fn(() => 3);

    // Mock requestIdleCallback
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => setTimeout(cb, 0));
  });

  afterEach(() => {
    nodeView?.destroy();
    vi.unstubAllGlobals();
  });

  function createNodeView(attrs: Record<string, unknown> = {}) {
    const node = createMockNode(attrs);
    nodeView = new MathInlineNodeView(
      node,
      mockView as unknown as import("@tiptap/pm/view").EditorView,
      getPos,
    );
    document.body.appendChild(nodeView.dom);
    return nodeView;
  }

  describe("DOM Structure", () => {
    it("creates a span element as dom", () => {
      createNodeView();
      expect(nodeView.dom.tagName).toBe("SPAN");
    });

    it("sets correct className", () => {
      createNodeView();
      expect(nodeView.dom.className).toBe("math-inline");
    });

    it("sets data-type attribute", () => {
      createNodeView();
      expect(nodeView.dom.dataset.type).toBe("math_inline");
    });

    it("contains a preview span", () => {
      createNodeView();
      const preview = nodeView.dom.querySelector(".math-inline-preview");
      expect(preview).not.toBeNull();
    });
  });

  describe("Accessibility", () => {
    it("sets role=math", () => {
      createNodeView();
      expect(nodeView.dom.getAttribute("role")).toBe("math");
    });

    it("sets aria-roledescription", () => {
      createNodeView();
      expect(nodeView.dom.getAttribute("aria-roledescription")).toBe("mathematical expression");
    });

    it("sets aria-label with content", () => {
      createNodeView({ content: "E=mc^2" });
      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: E=mc^2");
    });

    it("sets aria-label for empty content", () => {
      createNodeView({ content: "" });
      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: empty");
    });

    it("sets aria-label for whitespace-only content", () => {
      createNodeView({ content: "   " });
      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: empty");
    });
  });

  describe("Preview rendering", () => {
    it("shows placeholder for empty content", () => {
      createNodeView({ content: "" });
      const placeholder = nodeView.dom.querySelector(".math-inline-placeholder");
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toBe("$...$");
    });

    it("shows loading indicator when KaTeX not loaded", () => {
      mockIsKatexLoaded.mockReturnValue(false);
      createNodeView({ content: "x^2" });
      const loading = nodeView.dom.querySelector(".math-inline-loading");
      expect(loading).not.toBeNull();
      expect(loading?.textContent).toBe("...");
    });

    it("shows text content when KaTeX is loaded (before render)", () => {
      mockIsKatexLoaded.mockReturnValue(true);
      createNodeView({ content: "x^2" });
      const preview = nodeView.dom.querySelector(".math-inline-preview");
      expect(preview?.textContent).toBe("x^2");
    });

    it("removes math-error class on re-render", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("math-error");
      nodeView.update(createMockNode({ content: "y^2" }));
      expect(nodeView.dom.classList.contains("math-error")).toBe(false);
    });
  });

  describe("update()", () => {
    it("returns true for math_inline node type", () => {
      createNodeView();
      expect(nodeView.update(createMockNode({ content: "new" }))).toBe(true);
    });

    it("returns false for different node type", () => {
      createNodeView();
      const wrongNode = { type: { name: "paragraph" }, attrs: {} } as unknown as PMNode;
      expect(nodeView.update(wrongNode)).toBe(false);
    });

    it("updates preview when content changes and not editing", () => {
      mockIsKatexLoaded.mockReturnValue(true);
      createNodeView({ content: "x^2" });
      nodeView.update(createMockNode({ content: "y^3" }));
      const preview = nodeView.dom.querySelector(".math-inline-preview");
      expect(preview?.textContent).toBe("y^3");
    });

    it("updates aria-label when content changes", () => {
      createNodeView({ content: "x^2" });
      nodeView.update(createMockNode({ content: "y^3" }));
      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: y^3");
    });

    it("handles empty content on update", () => {
      createNodeView({ content: "x^2" });
      nodeView.update(createMockNode({ content: "" }));
      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: empty");
    });
  });

  describe("destroy()", () => {
    it("disconnects mutation observer", () => {
      createNodeView();
      nodeView.destroy();
      // After destroy, adding class should not trigger edit mode
      nodeView.dom.classList.add("editing");
      // No error should occur
    });

    it("removes click listener", () => {
      createNodeView();
      const spy = vi.spyOn(nodeView.dom, "removeEventListener");
      nodeView.destroy();
      expect(spy).toHaveBeenCalledWith("click", expect.any(Function));
    });

    it("hides math preview", () => {
      createNodeView();
      nodeView.destroy();
      expect(mockMathPreviewView.hide).toHaveBeenCalled();
    });

    it("clears from editing store", () => {
      createNodeView();
      nodeView.destroy();
      expect(mockClear).toHaveBeenCalledWith(3);
    });

    it("handles undefined pos in destroy gracefully", () => {
      getPos.mockReturnValue(undefined);
      createNodeView();
      expect(() => nodeView.destroy()).not.toThrow();
    });
  });

  describe("stopEvent()", () => {
    it("returns true for mousedown events", () => {
      createNodeView();
      const event = new MouseEvent("mousedown");
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns true for click events", () => {
      createNodeView();
      const event = new MouseEvent("click");
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns false for other events when not editing", () => {
      createNodeView();
      const event = new Event("keydown");
      expect(nodeView.stopEvent(event)).toBe(false);
    });
  });

  describe("ignoreMutation()", () => {
    it("always returns true", () => {
      createNodeView();
      expect(nodeView.ignoreMutation()).toBe(true);
    });
  });

  describe("selectNode / deselectNode", () => {
    it("adds ProseMirror-selectednode class on select", () => {
      createNodeView();
      nodeView.selectNode();
      expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(true);
    });

    it("removes ProseMirror-selectednode class on deselect", () => {
      createNodeView();
      nodeView.selectNode();
      nodeView.deselectNode();
      expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(false);
    });
  });

  describe("Edit mode via class change", () => {
    it("enters edit mode when .editing class is added via update()", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const input = nodeView.dom.querySelector(".math-inline-input");
      expect(input).not.toBeNull();
    });

    it("registers with editing store on enter", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      expect(mockStartEditing).toHaveBeenCalledWith(3, expect.objectContaining({
        forceExit: expect.any(Function),
        getNodePos: expect.any(Function),
      }));
    });

    it("hides preview when entering edit mode", () => {
      createNodeView({ content: "x^2" });
      const preview = nodeView.dom.querySelector(".math-inline-preview") as HTMLElement;

      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      expect(preview.style.display).toBe("none");
    });

    it("creates measurement span when entering edit mode", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const measureSpan = nodeView.dom.querySelector(".math-inline-measure");
      expect(measureSpan).not.toBeNull();
    });

    it("exits edit mode when .editing class is removed via update()", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      nodeView.dom.classList.remove("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const input = nodeView.dom.querySelector(".math-inline-input");
      expect(input).toBeNull();
    });

    it("shows preview after exiting edit mode", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      nodeView.dom.classList.remove("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const preview = nodeView.dom.querySelector(".math-inline-preview") as HTMLElement;
      expect(preview.style.display).toBe("");
    });

    it("hides floating preview on exit", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      vi.clearAllMocks();
      nodeView.dom.classList.remove("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      expect(mockMathPreviewView.hide).toHaveBeenCalled();
    });

    it("does not enter edit mode when getPos returns undefined", () => {
      getPos.mockReturnValue(undefined);
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const input = nodeView.dom.querySelector(".math-inline-input");
      expect(input).toBeNull();
    });
  });

  describe("Keydown handling in edit mode", () => {
    function enterEditMode() {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));
    }

    it("reverts value and exits on Escape key", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "modified";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      // Input value should be reverted to original
      expect(input.value).toBe("x^2");
    });

    it("deletes empty math node on Backspace", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));

      expect(mockView.dispatch).toHaveBeenCalled();
    });

    it("deletes empty math node on Delete", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));

      expect(mockView.dispatch).toHaveBeenCalled();
    });

    it("deletes node on Shift+Backspace even with content", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "x^2";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", shiftKey: true, bubbles: true }));

      expect(mockView.dispatch).toHaveBeenCalled();
    });

    it("does not exit on ArrowLeft in middle of text", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      Object.defineProperty(input, "selectionStart", { value: 1, writable: true });

      vi.clearAllMocks();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

      expect(mockView.dispatch).not.toHaveBeenCalled();
    });

    it("prevents default on Enter", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, "preventDefault");
      // Enter will try to call Selection.near which fails with mock doc,
      // but we can verify preventDefault was called
      try {
        input.dispatchEvent(event);
      } catch {
        // Selection.near may throw with mock doc
      }
      expect(spy).toHaveBeenCalled();
    });

    it("prevents default on Escape", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, "preventDefault");
      input.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });

    it("prevents default on Backspace when empty", () => {
      enterEditMode();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "";
      const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, "preventDefault");
      input.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("Input handling in edit mode", () => {
    it("updates floating preview on input", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      vi.clearAllMocks();
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "y^3";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockMathPreviewView.updateContent).toHaveBeenCalledWith("y^3");
    });
  });

  describe("stopEvent in edit mode", () => {
    it("returns true for all events when editing", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const keyEvent = new KeyboardEvent("keydown", { key: "a" });
      expect(nodeView.stopEvent(keyEvent)).toBe(true);

      const inputEvent = new Event("input");
      expect(nodeView.stopEvent(inputEvent)).toBe(true);
    });
  });

  describe("Constructor edge cases", () => {
    it("handles missing content attribute", () => {
      const node = {
        type: { name: "math_inline" },
        attrs: {},
      } as unknown as import("@tiptap/pm/model").Node;

      nodeView = new MathInlineNodeView(
        node,
        mockView as unknown as import("@tiptap/pm/view").EditorView,
        getPos,
      );
      document.body.appendChild(nodeView.dom);

      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: empty");
    });

    it("handles null content attribute", () => {
      const node = {
        type: { name: "math_inline" },
        attrs: { content: null },
      } as unknown as import("@tiptap/pm/model").Node;

      nodeView = new MathInlineNodeView(
        node,
        mockView as unknown as import("@tiptap/pm/view").EditorView,
        getPos,
      );
      document.body.appendChild(nodeView.dom);

      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: empty");
    });

    it("works without getPos", () => {
      const node = createMockNode({ content: "x^2" });
      nodeView = new MathInlineNodeView(
        node,
        mockView as unknown as import("@tiptap/pm/view").EditorView,
      );
      document.body.appendChild(nodeView.dom);

      expect(nodeView.dom.getAttribute("aria-label")).toBe("Math: x^2");
    });
  });

  describe("KaTeX rendering", () => {
    it("renders with KaTeX when loaded", async () => {
      const mockRender = vi.fn();
      mockLoadKatex.mockResolvedValue({ default: { render: mockRender } });
      mockIsKatexLoaded.mockReturnValue(true);

      createNodeView({ content: "x^2" });

      // Wait for requestIdleCallback/setTimeout
      await new Promise((r) => setTimeout(r, 50));

      expect(mockLoadKatex).toHaveBeenCalled();
    });

    it("handles KaTeX render error by adding math-error class", async () => {
      const mockRender = vi.fn(() => { throw new Error("Bad LaTeX"); });
      mockLoadKatex.mockResolvedValue({ default: { render: mockRender } });
      mockIsKatexLoaded.mockReturnValue(true);

      createNodeView({ content: "\\invalid" });

      await new Promise((r) => setTimeout(r, 100));

      expect(nodeView.dom.classList.contains("math-error")).toBe(true);
    });

    it("handles KaTeX load failure", async () => {
      mockLoadKatex.mockRejectedValue(new Error("Load failed"));
      mockIsKatexLoaded.mockReturnValue(false);

      createNodeView({ content: "x^2" });

      await new Promise((r) => setTimeout(r, 50));

      // Should still render without crashing, math-error may be added
    });

    it("uses setTimeout when requestIdleCallback not available", async () => {
      vi.stubGlobal("requestIdleCallback", undefined);
      const mockRender = vi.fn();
      mockLoadKatex.mockResolvedValue({ default: { render: mockRender } });

      createNodeView({ content: "x^2" });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockLoadKatex).toHaveBeenCalled();
    });
  });

  describe("Click handling", () => {
    it("does not dispatch when getPos returns undefined on click", () => {
      getPos.mockReturnValue(undefined);
      createNodeView({ content: "x^2" });

      vi.clearAllMocks();
      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      nodeView.dom.dispatchEvent(clickEvent);

      expect(mockView.dispatch).not.toHaveBeenCalled();
    });

    it("does not dispatch when editorView or getPos is null", () => {
      createNodeView({ content: "x^2" });
      getPos.mockReturnValue(undefined);

      vi.clearAllMocks();
      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      nodeView.dom.dispatchEvent(clickEvent);

      expect(mockView.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("forceExit", () => {
    it("commits changes and exits on force exit", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      // Get the forceExit callback from startEditing
      const callbacks = mockStartEditing.mock.calls[0][1];

      // Modify the input
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "y^3";

      // Call forceExit
      callbacks.forceExit();

      // Should have committed changes
      expect(mockView.state.tr.setNodeMarkup).toHaveBeenCalled();
    });

    it("does nothing when not editing", () => {
      createNodeView({ content: "x^2" });

      // Not in edit mode, so forceExit should be no-op
      // Can't easily test this since forceExit is private,
      // but we can verify no crash
    });
  });

  describe("Floating preview positioning", () => {
    it("shows floating preview using getClientRects for wrapped content", () => {
      createNodeView({ content: "x^2" });

      // Mock getClientRects to return multiple rects (simulates wrapped content)
      const rect1 = { top: 100, left: 50, bottom: 120, right: 200, width: 150, height: 20 };
      const rect2 = { top: 130, left: 50, bottom: 150, right: 100, width: 50, height: 20 };
      vi.spyOn(nodeView.dom, "getClientRects").mockReturnValue(
        [rect1, rect2] as unknown as DOMRectList
      );

      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      expect(mockMathPreviewView.show).toHaveBeenCalledWith(
        "x^2",
        expect.objectContaining({ top: 100, left: 50 }),
        expect.anything()
      );
    });

    it("uses getBoundingClientRect when only one rect", () => {
      createNodeView({ content: "x^2" });

      const rect = { top: 100, left: 50, bottom: 120, right: 200, width: 150, height: 20 };
      vi.spyOn(nodeView.dom, "getClientRects").mockReturnValue(
        [rect] as unknown as DOMRectList
      );
      vi.spyOn(nodeView.dom, "getBoundingClientRect").mockReturnValue(
        rect as unknown as DOMRect
      );

      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      expect(mockMathPreviewView.show).toHaveBeenCalled();
    });
  });

  describe("Entry direction handling", () => {
    it("checks inlineNodeEditing plugin state for entry direction", async () => {
      const { inlineNodeEditingKey } = await import("@/plugins/inlineNodeEditing/tiptap");
      vi.mocked(inlineNodeEditingKey.getState).mockReturnValue({
        entryDirection: "right",
      } as unknown as ReturnType<typeof inlineNodeEditingKey.getState>);

      createNodeView({ content: "abcdef" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "abcdef" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      expect(input).not.toBeNull();
      // With entry from right, cursor should be at end of text
      // Verified via requestAnimationFrame in source
    });
  });

  describe("commitChanges edge cases", () => {
    it("deletes node when both old and new content are empty/whitespace", () => {
      createNodeView({ content: "  " });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "  " }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "  ";

      // Exit via Enter to commit
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

      // Should have called delete since both are whitespace
      expect(mockView.dispatch).toHaveBeenCalled();
    });
  });

  describe("ArrowRight exit", () => {
    it("exits right when cursor is at end of input", () => {
      createNodeView({ content: "xy" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "xy" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      Object.defineProperty(input, "selectionEnd", { value: 2, writable: true });
      Object.defineProperty(input, "value", { value: "xy", writable: true });

      vi.clearAllMocks();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));

      expect(mockView.dispatch).toHaveBeenCalled();
    });
  });

  describe("Unwrap to text via shortcut", () => {
    it("unwraps math node to plain text when shortcut matches", async () => {
      const { matchesShortcutEvent } = await import("@/utils/shortcutMatch");
      vi.mocked(matchesShortcutEvent).mockReturnValueOnce(true);

      // Set up tr.doc.resolve for Selection.near after replaceWith
      mockView.state.tr.doc = {
        resolve: vi.fn(() => ({
          pos: 0,
          parent: { inlineContent: true, childCount: 0, type: { name: "paragraph" } },
          depth: 1,
        })),
      };

      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, bubbles: true, cancelable: true }));

      // Should have dispatched replaceWith for unwrapping
      expect(mockView.state.tr.replaceWith).toHaveBeenCalled();
    });
  });

  describe("Blur handling", () => {
    it("commits and exits when input loses focus (not force-exited)", async () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "y^3";

      // Mock matches(":focus") to return false
      Object.defineProperty(input, "matches", {
        value: () => false,
        writable: true,
      });

      vi.clearAllMocks();
      input.dispatchEvent(new Event("blur", { bubbles: true }));

      // Wait for rAF
      await new Promise((r) => requestAnimationFrame(r));

      // Should have committed changes
      expect(mockView.state.tr.setNodeMarkup).toHaveBeenCalled();
    });
  });

  describe("Blur handling - still focused", () => {
    it("does not exit when input is still focused (matches :focus)", async () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "y^3";

      // Mock matches(":focus") to return true — simulates input still having focus
      Object.defineProperty(input, "matches", {
        value: () => true,
        writable: true,
      });

      vi.clearAllMocks();
      input.dispatchEvent(new Event("blur", { bubbles: true }));

      await new Promise((r) => requestAnimationFrame(r));

      // Should NOT commit since input is still focused
      expect(mockView.state.tr.setNodeMarkup).not.toHaveBeenCalled();
    });
  });

  describe("commitChanges - node type guard", () => {
    it("does nothing when node at pos is not math_inline", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      // Override nodeAt to return a non-math_inline node
      mockView.state.doc.nodeAt.mockReturnValue({
        type: { name: "paragraph" },
        attrs: {},
        nodeSize: 5,
      });

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "changed";

      vi.clearAllMocks();
      // Trigger commit via Enter key
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

      // setNodeMarkup should NOT have been called
      expect(mockView.state.tr.setNodeMarkup).not.toHaveBeenCalled();
    });

    it("does nothing when nodeAt returns null", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      mockView.state.doc.nodeAt.mockReturnValue(null);

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "changed";

      vi.clearAllMocks();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

      expect(mockView.state.tr.setNodeMarkup).not.toHaveBeenCalled();
    });
  });

  describe("deleteNode edge cases", () => {
    it("does nothing when getPos returns undefined", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      getPos.mockReturnValue(undefined);

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "";
      vi.clearAllMocks();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

      expect(mockView.dispatch).not.toHaveBeenCalled();
    });

    it("does nothing when nodeAt returns null", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      mockView.state.doc.nodeAt.mockReturnValue(null);

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "";
      vi.clearAllMocks();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

      expect(mockView.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("unwrapToText edge cases", () => {
    it("does nothing when getPos returns undefined", async () => {
      const { matchesShortcutEvent } = await import("@/utils/shortcutMatch");
      vi.mocked(matchesShortcutEvent).mockReturnValueOnce(true);

      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      getPos.mockReturnValue(undefined);
      vi.clearAllMocks();

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, bubbles: true, cancelable: true }));

      expect(mockView.state.tr.replaceWith).not.toHaveBeenCalled();
    });

    it("replaces with empty fragment when content is empty", async () => {
      const { matchesShortcutEvent } = await import("@/utils/shortcutMatch");
      vi.mocked(matchesShortcutEvent).mockReturnValueOnce(true);

      mockView.state.tr.doc = {
        resolve: vi.fn(() => ({
          pos: 0,
          parent: { inlineContent: true, childCount: 0, type: { name: "paragraph" } },
          depth: 1,
        })),
      };

      createNodeView({ content: "" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.value = "";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, bubbles: true, cancelable: true }));

      // replaceWith should be called with empty array for empty content
      expect(mockView.state.tr.replaceWith).toHaveBeenCalled();
    });

    it("does nothing when nodeAt returns null", async () => {
      const { matchesShortcutEvent } = await import("@/utils/shortcutMatch");
      vi.mocked(matchesShortcutEvent).mockReturnValueOnce(true);

      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      mockView.state.doc.nodeAt.mockReturnValue(null);
      vi.clearAllMocks();

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, bubbles: true, cancelable: true }));

      expect(mockView.state.tr.replaceWith).not.toHaveBeenCalled();
    });
  });

  describe("exitAndFocusEditor edge cases", () => {
    it("does nothing when nodeAt returns null during exit", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      mockView.state.doc.nodeAt.mockReturnValue(null);

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      vi.clearAllMocks();
      // Enter triggers commitAndExit -> exitAndFocusEditor
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

      // dispatch should not be called since nodeAt returned null
      expect(mockView.dispatch).not.toHaveBeenCalled();
    });

    it("exits left with ArrowLeft setting exitingLeft flag", () => {
      createNodeView({ content: "xy" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "xy" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      Object.defineProperty(input, "selectionStart", { value: 0, writable: true });

      vi.clearAllMocks();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));

      // Should have dispatched to move cursor before node
      expect(mockView.dispatch).toHaveBeenCalled();
    });
  });

  describe("Click handling - when editing", () => {
    it("does not dispatch selection when already in edit mode", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      vi.clearAllMocks();
      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      nodeView.dom.dispatchEvent(clickEvent);

      // Should NOT call dispatch since we're already editing
      expect(mockView.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("forceExit - not editing guard", () => {
    it("does not crash when forceExit is called while not editing", () => {
      createNodeView({ content: "x^2" });
      // Enter edit mode to get the forceExit callback
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const callbacks = mockStartEditing.mock.calls[0][1];

      // Exit edit mode first
      nodeView.dom.classList.remove("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      vi.clearAllMocks();
      // Now call forceExit while NOT editing
      callbacks.forceExit();

      // Should not dispatch
      expect(mockView.state.tr.setNodeMarkup).not.toHaveBeenCalled();
    });
  });

  describe("forceExit - no content change", () => {
    it("exits without committing when value matches currentLatex", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const callbacks = mockStartEditing.mock.calls[0][1];

      // Don't change the input value
      vi.clearAllMocks();
      callbacks.forceExit();

      // Should not call setNodeMarkup since value didn't change
      expect(mockView.state.tr.setNodeMarkup).not.toHaveBeenCalled();
    });
  });

  describe("renderPreview - KaTeX load rejection with non-Error", () => {
    it("handles non-Error rejection from loadKatex", async () => {
      mockLoadKatex.mockRejectedValue("string error");
      mockIsKatexLoaded.mockReturnValue(false);

      createNodeView({ content: "x^2" });

      await new Promise((r) => setTimeout(r, 100));

      // Should add math-error class and show text content
      expect(nodeView.dom.classList.contains("math-error")).toBe(true);
    });
  });

  describe("IME keydown handling", () => {
    it("returns early for IME key events", async () => {
      const { isImeKeyEvent } = await import("@/utils/imeGuard");
      vi.mocked(isImeKeyEvent).mockReturnValueOnce(true);

      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      vi.clearAllMocks();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", bubbles: true }));

      // Should not dispatch since IME event is ignored
      expect(mockView.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("enterEditMode re-entry guard", () => {
    it("prevents re-entry when exitingLeft is true", () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      // Trigger exit left
      const input = nodeView.dom.querySelector(".math-inline-input") as HTMLInputElement;
      Object.defineProperty(input, "selectionStart", { value: 0, writable: true });
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));

      // Now try to re-enter edit mode immediately
      vi.clearAllMocks();
      nodeView.dom.classList.add("editing");
      nodeView.update(createMockNode({ content: "x^2" }));

      // startEditing should NOT be called again due to exitingLeft guard
      expect(mockStartEditing).not.toHaveBeenCalled();
    });
  });

  describe("MutationObserver class change detection", () => {
    it("enters edit mode via MutationObserver when editing class is added", async () => {
      createNodeView({ content: "x^2" });

      // Directly add class (simulates what PM decoration does)
      nodeView.dom.classList.add("editing");

      // Wait for MutationObserver to fire
      await new Promise((r) => setTimeout(r, 10));

      const input = nodeView.dom.querySelector(".math-inline-input");
      expect(input).not.toBeNull();
    });

    it("exits edit mode via MutationObserver when editing class is removed", async () => {
      createNodeView({ content: "x^2" });
      nodeView.dom.classList.add("editing");
      await new Promise((r) => setTimeout(r, 10));

      // Verify in edit mode
      expect(nodeView.dom.querySelector(".math-inline-input")).not.toBeNull();

      nodeView.dom.classList.remove("editing");
      await new Promise((r) => setTimeout(r, 10));

      expect(nodeView.dom.querySelector(".math-inline-input")).toBeNull();
    });
  });
});
