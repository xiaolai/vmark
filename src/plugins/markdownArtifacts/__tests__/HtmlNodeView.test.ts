/**
 * HtmlNodeView Tests
 *
 * Tests for the HTML node view (both inline and block variants) including:
 * - Constructor creates correct DOM structure
 * - Rendering modes (hidden, sanitized, sanitizedWithStyles)
 * - Update method handles attribute changes
 * - Destroy cleanup (store subscription)
 * - Double-click switches to source mode
 * - ignoreMutation always returns true
 * - Edge cases (empty value, missing attrs)
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";

// Mock dependencies before imports
const mockSanitizeHtmlPreview = vi.fn((html: string) => `sanitized:${html}`);
const mockToggleSourceModeWithCheckpoint = vi.fn();
const mockSetCursorInfo = vi.fn();
let mockHtmlRenderingMode = "sanitized";
let storeSubscriber: ((state: { markdown: { htmlRenderingMode: string } }) => void) | null = null;
const mockUnsubscribe = vi.fn();

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      markdown: { htmlRenderingMode: mockHtmlRenderingMode },
    }),
    subscribe: (cb: (state: { markdown: { htmlRenderingMode: string } }) => void) => {
      storeSubscriber = cb;
      return mockUnsubscribe;
    },
  },
}));

// Per ADR-009: cursorInfo lives in documentStore (per-tab), not uiStore.
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      setCursorInfo: mockSetCursorInfo,
    }),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      activeTabId: { main: "tab-1" },
    }),
  },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

// HtmlNodeView routes mode toggles through the checkpoint-aware helper
// from useUnifiedHistory (per ADR-009 mirror invariants).
vi.mock("@/hooks/useUnifiedHistory", () => ({
  toggleSourceModeWithCheckpoint: (...args: unknown[]) =>
    mockToggleSourceModeWithCheckpoint(...args),
}));

vi.mock("@/utils/sanitize", () => ({
  sanitizeHtmlPreview: (...args: unknown[]) => mockSanitizeHtmlPreview(...args),
}));

import { createHtmlInlineNodeView, createHtmlBlockNodeView } from "../HtmlNodeView";
import type { NodeView } from "@tiptap/pm/view";

// --- Helpers ---

function createMockNode(attrs: Record<string, unknown> = {}, typeName = "html_inline"): PMNode {
  return {
    type: { name: typeName },
    attrs: {
      value: attrs.value ?? "<b>hello</b>",
      sourceLine: attrs.sourceLine ?? null,
      ...attrs,
    },
  } as unknown as PMNode;
}

describe("HtmlNodeView (inline)", () => {
  let nodeView: NodeView;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = "";
    mockHtmlRenderingMode = "sanitized";
    storeSubscriber = null;
  });

  afterEach(() => {
    nodeView?.destroy?.();
  });

  function createInlineView(attrs: Record<string, unknown> = {}) {
    const node = createMockNode(attrs, "html_inline");
    nodeView = createHtmlInlineNodeView(node);
    document.body.appendChild(nodeView.dom);
    return nodeView;
  }

  describe("DOM Structure", () => {
    it("creates a span element for inline variant", () => {
      createInlineView();
      expect(nodeView.dom.tagName).toBe("SPAN");
    });

    it("sets data-type attribute", () => {
      createInlineView();
      expect(nodeView.dom.getAttribute("data-type")).toBe("html");
    });

    it("sets contenteditable to false", () => {
      createInlineView();
      expect(nodeView.dom.getAttribute("contenteditable")).toBe("false");
    });

    it("sets correct className for inline", () => {
      createInlineView();
      expect(nodeView.dom.className).toBe("html-preview-inline");
    });

    it("sets data-value attribute", () => {
      createInlineView({ value: "<em>test</em>" });
      expect(nodeView.dom.getAttribute("data-value")).toBe("<em>test</em>");
    });
  });

  describe("Rendering modes", () => {
    it("renders sanitized HTML in sanitized mode", () => {
      mockHtmlRenderingMode = "sanitized";
      createInlineView({ value: "<b>bold</b>" });
      expect(mockSanitizeHtmlPreview).toHaveBeenCalledWith("<b>bold</b>", {
        allowStyles: false,
        context: "inline",
      });
    });

    it("renders with styles in sanitizedWithStyles mode", () => {
      mockHtmlRenderingMode = "sanitizedWithStyles";
      createInlineView({ value: "<span>red</span>" });
      expect(mockSanitizeHtmlPreview).toHaveBeenCalledWith(
        "<span>red</span>",
        { allowStyles: true, context: "inline" },
      );
    });

    it("hides element in hidden mode", () => {
      mockHtmlRenderingMode = "hidden";
      createInlineView({ value: "<b>hidden</b>" });
      expect(nodeView.dom.style.display).toBe("none");
    });

    it("sets data-render-mode attribute", () => {
      mockHtmlRenderingMode = "sanitized";
      createInlineView();
      expect(nodeView.dom.getAttribute("data-render-mode")).toBe("sanitized");
    });

    it("sets data-allow-styles attribute to false in sanitized mode", () => {
      mockHtmlRenderingMode = "sanitized";
      createInlineView();
      expect(nodeView.dom.getAttribute("data-allow-styles")).toBe("false");
    });

    it("sets data-allow-styles attribute to true in sanitizedWithStyles mode", () => {
      mockHtmlRenderingMode = "sanitizedWithStyles";
      createInlineView();
      expect(nodeView.dom.getAttribute("data-allow-styles")).toBe("true");
    });
  });

  describe("Settings subscription", () => {
    it("re-renders when rendering mode changes via store", () => {
      mockHtmlRenderingMode = "sanitized";
      createInlineView({ value: "<b>test</b>" });
      vi.clearAllMocks();

      storeSubscriber?.({ markdown: { htmlRenderingMode: "hidden" } });
      expect(nodeView.dom.style.display).toBe("none");
    });

    it("does not re-render when mode stays the same", () => {
      mockHtmlRenderingMode = "sanitized";
      createInlineView({ value: "<b>test</b>" });
      vi.clearAllMocks();

      storeSubscriber?.({ markdown: { htmlRenderingMode: "sanitized" } });
      expect(mockSanitizeHtmlPreview).not.toHaveBeenCalled();
    });

    it("switches from hidden to visible when mode changes", () => {
      mockHtmlRenderingMode = "hidden";
      createInlineView({ value: "<b>test</b>" });
      expect(nodeView.dom.style.display).toBe("none");

      storeSubscriber?.({ markdown: { htmlRenderingMode: "sanitized" } });
      expect(nodeView.dom.style.display).toBe("inline");
    });
  });

  describe("update()", () => {
    it("returns true for html_inline node type", () => {
      createInlineView();
      const result = nodeView.update!(createMockNode({ value: "new" }, "html_inline"));
      expect(result).toBe(true);
    });

    it("returns false for different node type", () => {
      createInlineView();
      const wrongNode = { type: { name: "paragraph" }, attrs: {} } as unknown as PMNode;
      expect(nodeView.update!(wrongNode)).toBe(false);
    });

    it("re-renders when value changes", () => {
      createInlineView({ value: "<b>old</b>" });
      vi.clearAllMocks();

      nodeView.update!(createMockNode({ value: "<em>new</em>" }, "html_inline"));
      expect(mockSanitizeHtmlPreview).toHaveBeenCalledWith("<em>new</em>", expect.any(Object));
    });

    it("does not re-render when value stays the same", () => {
      createInlineView({ value: "<b>same</b>" });
      vi.clearAllMocks();

      nodeView.update!(createMockNode({ value: "<b>same</b>" }, "html_inline"));
      expect(mockSanitizeHtmlPreview).not.toHaveBeenCalled();
    });

    it("handles empty value", () => {
      createInlineView({ value: "<b>test</b>" });
      nodeView.update!(createMockNode({ value: "" }, "html_inline"));
      expect(nodeView.dom.getAttribute("data-value")).toBe("");
    });

    it("handles undefined value", () => {
      createInlineView();
      nodeView.update!(createMockNode({ value: undefined }, "html_inline"));
      expect(nodeView.dom.getAttribute("data-value")).toBe("");
    });
  });

  describe("destroy()", () => {
    it("removes dblclick listener", () => {
      createInlineView();
      const spy = vi.spyOn(nodeView.dom, "removeEventListener");
      nodeView.destroy!();
      expect(spy).toHaveBeenCalledWith("dblclick", expect.any(Function));
    });

    it("unsubscribes from settings store", () => {
      createInlineView();
      nodeView.destroy!();
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe("ignoreMutation()", () => {
    it("always returns true", () => {
      createInlineView();
      expect(nodeView.ignoreMutation!()).toBe(true);
    });
  });

  describe("Double-click to source mode", () => {
    it("toggles source mode on double-click", () => {
      createInlineView();
      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(mockToggleSourceModeWithCheckpoint).toHaveBeenCalledWith("main");
    });

    it("sets cursor info when sourceLine is available", () => {
      createInlineView({ sourceLine: 42 });
      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      // Per ADR-009: setCursorInfo signature is (tabId, info).
      expect(mockSetCursorInfo).toHaveBeenCalledWith(
        "tab-1",
        expect.objectContaining({ sourceLine: 42 }),
      );
    });

    it("does not set cursor info when sourceLine is null", () => {
      createInlineView({ sourceLine: null });
      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });
  });
});

describe("HtmlNodeView (block)", () => {
  let nodeView: NodeView;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = "";
    mockHtmlRenderingMode = "sanitized";
    storeSubscriber = null;
  });

  afterEach(() => {
    nodeView?.destroy?.();
  });

  function createBlockView(attrs: Record<string, unknown> = {}) {
    const node = createMockNode(attrs, "html_block");
    nodeView = createHtmlBlockNodeView(node);
    document.body.appendChild(nodeView.dom);
    return nodeView;
  }

  describe("DOM Structure", () => {
    it("creates a div element for block variant", () => {
      createBlockView();
      expect(nodeView.dom.tagName).toBe("DIV");
    });

    it("sets data-type to html-block", () => {
      createBlockView();
      expect(nodeView.dom.getAttribute("data-type")).toBe("html-block");
    });

    it("sets correct className for block", () => {
      createBlockView();
      expect(nodeView.dom.className).toBe("html-preview-block");
    });
  });

  describe("Rendering", () => {
    it("passes block context to sanitizer", () => {
      mockHtmlRenderingMode = "sanitized";
      createBlockView({ value: "<div>block</div>" });
      expect(mockSanitizeHtmlPreview).toHaveBeenCalledWith("<div>block</div>", {
        allowStyles: false,
        context: "block",
      });
    });

    it("sets display to block when visible", () => {
      mockHtmlRenderingMode = "sanitized";
      createBlockView();
      expect(nodeView.dom.style.display).toBe("block");
    });

    it("hides in hidden mode", () => {
      mockHtmlRenderingMode = "hidden";
      createBlockView();
      expect(nodeView.dom.style.display).toBe("none");
    });
  });

  describe("update()", () => {
    it("returns true for html_block node type", () => {
      createBlockView();
      const result = nodeView.update!(createMockNode({ value: "new" }, "html_block"));
      expect(result).toBe(true);
    });

    it("returns false for html_inline node type", () => {
      createBlockView();
      const wrongNode = createMockNode({}, "html_inline");
      expect(nodeView.update!(wrongNode)).toBe(false);
    });
  });
});
