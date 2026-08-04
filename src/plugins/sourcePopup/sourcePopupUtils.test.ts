/**
 * Tests for sourcePopupUtils — popup positioning helpers for Source mode.
 */

import { describe, it, expect, vi } from "vitest";
import { Text, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  getEditorContainer,
  getPopupHost,
  toHostCoords,
  getAnchorRectFromRange,
  getEditorBounds,
  isPositionVisible,
  getLineNumber,
  scrollIntoViewIfNeeded,
  posToLineCol,
  lineColToPos,
} from "./sourcePopupUtils";

// ---------------------------------------------------------------------------
// Mock EditorView helpers
// ---------------------------------------------------------------------------

function createMockView(options?: {
  hasContainer?: boolean;
  hasCmContent?: boolean;
  coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number; right: number } | null;
  docContent?: string;
}): EditorView {
  const {
    hasContainer = false,
    hasCmContent = false,
    coordsAtPos = () => ({ top: 10, bottom: 20, left: 30, right: 40 }),
    docContent = "hello\nworld\nline3",
  } = options ?? {};

  const editorDom = document.createElement("div");
  editorDom.className = "cm-editor";
  editorDom.getBoundingClientRect = () => ({
    top: 0, left: 0, bottom: 400, right: 600, width: 600, height: 400,
    x: 0, y: 0, toJSON: () => ({}),
  });

  if (hasCmContent) {
    const cmContent = document.createElement("div");
    cmContent.className = "cm-content";
    cmContent.getBoundingClientRect = () => ({
      top: 10, left: 20, bottom: 390, right: 580, width: 560, height: 380,
      x: 20, y: 10, toJSON: () => ({}),
    });
    editorDom.appendChild(cmContent);
  }

  if (hasContainer) {
    const container = document.createElement("div");
    container.className = "editor-container";
    container.style.position = "relative";
    container.getBoundingClientRect = () => ({
      top: 0, left: 0, bottom: 500, right: 800, width: 800, height: 500,
      x: 0, y: 0, toJSON: () => ({}),
    });
    container.appendChild(editorDom);
    document.body.appendChild(container);
  }

  const doc = Text.of(docContent.split("\n"));
  const state = EditorState.create({ doc });

  return {
    dom: editorDom,
    state,
    coordsAtPos,
    dispatch: vi.fn(),
  } as unknown as EditorView;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getEditorContainer", () => {
  it("returns editor-container when present", () => {
    const view = createMockView({ hasContainer: true });
    const result = getEditorContainer(view);
    expect(result).not.toBeNull();
    expect(result!.className).toBe("editor-container");
    view.dom.closest(".editor-container")?.remove();
  });

  it("returns null when no container", () => {
    const view = createMockView({ hasContainer: false });
    expect(getEditorContainer(view)).toBeNull();
  });
});

describe("getPopupHost", () => {
  it("returns editor-container when present", () => {
    const view = createMockView({ hasContainer: true });
    const result = getPopupHost(view);
    expect(result).not.toBeNull();
    expect(result!.className).toBe("editor-container");
    view.dom.closest(".editor-container")?.remove();
  });

  it("returns parentElement when no editor-container", () => {
    const parent = document.createElement("div");
    parent.className = "parent";
    const view = createMockView({ hasContainer: false });
    parent.appendChild(view.dom);
    expect(getPopupHost(view)).toBe(parent);
  });
});

describe("toHostCoords", () => {
  it("converts viewport coordinates to host-relative", () => {
    const host = document.createElement("div");
    host.getBoundingClientRect = () => ({
      top: 50, left: 30, bottom: 400, right: 600, width: 570, height: 350,
      x: 30, y: 50, toJSON: () => ({}),
    });
    Object.defineProperty(host, "scrollTop", { value: 0, configurable: true });
    Object.defineProperty(host, "scrollLeft", { value: 0, configurable: true });

    const result = toHostCoords(host, { top: 100, left: 80 });
    expect(result.top).toBe(50);   // 100 - 50
    expect(result.left).toBe(50);  // 80 - 30
  });
});

describe("getAnchorRectFromRange", () => {
  it("returns anchor rect from valid coords", () => {
    const view = createMockView({
      coordsAtPos: (pos) => ({
        top: pos * 10,
        bottom: pos * 10 + 20,
        left: pos * 5,
        right: pos * 5 + 50,
      }),
    });

    const result = getAnchorRectFromRange(view, 1, 5);
    expect(result).not.toBeNull();
    expect(result!.top).toBe(10);
    expect(result!.left).toBe(5);
    expect(result!.bottom).toBe(70);
    expect(result!.right).toBe(75);
  });

  it("returns null when coordsAtPos returns null for start", () => {
    const view = createMockView({
      coordsAtPos: () => null,
    });
    expect(getAnchorRectFromRange(view, 0, 5)).toBeNull();
  });
});

describe("getEditorBounds", () => {
  it("returns viewport bounds when no container", () => {
    const view = createMockView({ hasContainer: false });
    const bounds = getEditorBounds(view);
    expect(bounds).toBeDefined();
    expect(bounds.horizontal).toBeDefined();
    expect(bounds.vertical).toBeDefined();
  });

  it("returns content-based bounds when cm-content exists", () => {
    const view = createMockView({ hasContainer: true, hasCmContent: true });
    const bounds = getEditorBounds(view);
    expect(bounds.vertical.top).toBe(0);
    expect(bounds.vertical.bottom).toBe(500);
    view.dom.closest(".editor-container")?.remove();
  });

  it("returns editor-based bounds when no cm-content", () => {
    const view = createMockView({ hasContainer: true, hasCmContent: false });
    const bounds = getEditorBounds(view);
    expect(bounds.horizontal).toBeDefined();
    expect(bounds.vertical.top).toBe(0);
    view.dom.closest(".editor-container")?.remove();
  });
});

describe("isPositionVisible", () => {
  it("returns true when position is in viewport", () => {
    const view = createMockView({
      hasContainer: true,
      coordsAtPos: () => ({ top: 100, bottom: 120, left: 50, right: 100 }),
    });
    expect(isPositionVisible(view, 1)).toBe(true);
    view.dom.closest(".editor-container")?.remove();
  });

  it("returns false when coords are null", () => {
    const view = createMockView({ coordsAtPos: () => null });
    expect(isPositionVisible(view, 1)).toBe(false);
  });

  it("returns false when position is below container", () => {
    const view = createMockView({
      hasContainer: true,
      coordsAtPos: () => ({ top: 600, bottom: 620, left: 50, right: 100 }),
    });
    expect(isPositionVisible(view, 1)).toBe(false);
    view.dom.closest(".editor-container")?.remove();
  });

  it("uses window viewport when no container", () => {
    const view = createMockView({
      hasContainer: false,
      coordsAtPos: () => ({ top: 10, bottom: 20, left: 0, right: 100 }),
    });
    expect(isPositionVisible(view, 1)).toBe(true);
  });
});

describe("getLineNumber", () => {
  it("returns 1-indexed line number", () => {
    const view = createMockView({ docContent: "hello\nworld\nthird" });
    expect(getLineNumber(view, 0)).toBe(1);
    expect(getLineNumber(view, 6)).toBe(2);
    expect(getLineNumber(view, 12)).toBe(3);
  });
});

describe("scrollIntoViewIfNeeded", () => {
  it("dispatches when position is not visible", () => {
    const view = createMockView({
      coordsAtPos: () => null,  // null coords = not visible
    });
    scrollIntoViewIfNeeded(view, 0);
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("does not dispatch when position is visible", () => {
    const view = createMockView({
      hasContainer: false,
      coordsAtPos: () => ({ top: 10, bottom: 20, left: 0, right: 100 }),
    });
    scrollIntoViewIfNeeded(view, 0);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("posToLineCol", () => {
  it("converts position to line and column", () => {
    const view = createMockView({ docContent: "hello\nworld" });
    const result = posToLineCol(view, 7);
    expect(result.line).toBe(2);
    expect(result.col).toBe(1);
  });
});

describe("lineColToPos", () => {
  it("converts line and column to position", () => {
    const view = createMockView({ docContent: "hello\nworld" });
    const pos = lineColToPos(view, 2, 3);
    expect(pos).toBe(9); // "wor" -> offset 6 + 3
  });

  it("clamps line to doc.lines", () => {
    const view = createMockView({ docContent: "hello\nworld" });
    const pos = lineColToPos(view, 999, 0);
    expect(pos).toBe(view.state.doc.line(2).from);
  });

  it("clamps column to line end", () => {
    const view = createMockView({ docContent: "hi\nworld" });
    const pos = lineColToPos(view, 1, 999);
    expect(pos).toBe(2); // "hi" ends at 2
  });
});
