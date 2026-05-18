/**
 * Extended Source Shortcuts Tests
 *
 * Tests for buildSourceShortcutKeymap, bindIfKey, getSourceBlockBounds,
 * smart select-all, and select-all undo.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// --- Mocks ---

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      toggleSidebar: vi.fn(),
    }),
  },
}));

vi.mock("@/utils/imeGuard", () => ({
  guardCodeMirrorKeyBinding: (binding: unknown) => binding,
}));

const mockGetCodeFenceInfo = vi.fn(() => null);
vi.mock("@/plugins/sourceContextDetection/codeFenceDetection", () => ({
  getCodeFenceInfo: (...args: unknown[]) => mockGetCodeFenceInfo(...args),
}));

const mockGetSourceTableInfo = vi.fn(() => null);
vi.mock("@/plugins/sourceContextDetection/tableDetection", () => ({
  getSourceTableInfo: (...args: unknown[]) => mockGetSourceTableInfo(...args),
}));

const mockGetBlockquoteInfo = vi.fn(() => null);
vi.mock("@/plugins/sourceContextDetection/blockquoteDetection", () => ({
  getBlockquoteInfo: (...args: unknown[]) => mockGetBlockquoteInfo(...args),
}));

const mockGetListBlockBounds = vi.fn(() => null);
vi.mock("@/plugins/sourceContextDetection/listDetection", () => ({
  getListBlockBounds: (...args: unknown[]) => mockGetListBlockBounds(...args),
}));

// Mock all sourceShortcutsHelpers
vi.mock("../sourceShortcutsHelpers", () => ({
  runSourceAction: () => () => true,
  setHeading: () => () => true,
  increaseHeadingLevel: () => true,
  decreaseHeadingLevel: () => true,
  toggleBlockquote: () => true,
  toggleList: () => true,
  openFindBar: () => true,
  findNextMatch: () => true,
  findPreviousMatch: () => true,
  formatCJKSelection: () => true,
  formatCJKFile: () => true,
  copySelectionAsHtml: () => true,
  doTransformUppercase: () => true,
  doTransformLowercase: () => true,
  doTransformTitleCase: () => true,
  doTransformToggleCase: () => true,
  doMoveLineUp: () => true,
  doMoveLineDown: () => true,
  doDuplicateLine: () => true,
  doDeleteLine: () => true,
  doJoinLines: () => true,
  doSortLinesAsc: () => true,
  doSortLinesDesc: () => true,
}));

import { useShortcutsStore } from "@/stores/shortcutsStore";
import { buildSourceShortcutKeymap, getSourceBlockBounds } from "../sourceShortcuts";

const viewInstances: EditorView[] = [];

function createView(content: string, cursorPos?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos ?? 0 },
  });
  const view = new EditorView({ state, parent });
  viewInstances.push(view);
  return view;
}

beforeEach(() => {
  mockGetCodeFenceInfo.mockReset();
  mockGetSourceTableInfo.mockReset();
  mockGetBlockquoteInfo.mockReset();
  mockGetListBlockBounds.mockReset();
  useShortcutsStore.setState({ customBindings: {} });
});

afterEach(() => {
  viewInstances.forEach((v) => {
    const parent = v.dom.parentElement;
    v.destroy();
    parent?.remove();
  });
  viewInstances.length = 0;
});

describe("buildSourceShortcutKeymap", () => {
  it("returns an array of key bindings", () => {
    const bindings = buildSourceShortcutKeymap();
    expect(Array.isArray(bindings)).toBe(true);
    expect(bindings.length).toBeGreaterThan(0);
  });

  it("includes all standard shortcut categories", () => {
    const bindings = buildSourceShortcutKeymap();
    const keys = bindings.map((b) => b.key).filter(Boolean);

    // Should have many bindings from all categories
    expect(keys.length).toBeGreaterThan(20);
  });

  it("always includes Mod-a for smart select-all", () => {
    const bindings = buildSourceShortcutKeymap();
    const keys = bindings.map((b) => b.key);
    expect(keys).toContain("Mod-a");
  });

  it("always includes Mod-z for smart select-all undo", () => {
    const bindings = buildSourceShortcutKeymap();
    const keys = bindings.map((b) => b.key);
    expect(keys).toContain("Mod-z");
  });

  it("skips bindings with empty key", () => {
    // Set a shortcut to empty string
    useShortcutsStore.setState({
      customBindings: { bold: "" },
    });
    const bindings = buildSourceShortcutKeymap();
    const keys = bindings.map((b) => b.key);

    // Empty key should not appear
    expect(keys).not.toContain("");
    expect(keys).not.toContain(undefined);
  });

  it("uses custom bindings from store", () => {
    useShortcutsStore.setState({
      customBindings: { italic: "Alt-i" },
    });
    const bindings = buildSourceShortcutKeymap();
    const keys = bindings.map((b) => b.key);
    expect(keys).toContain("Alt-i");
  });
});

describe("getSourceBlockBounds", () => {
  it("returns null when not in any block", () => {
    const view = createView("plain text");
    mockGetCodeFenceInfo.mockReturnValueOnce(null);
    mockGetSourceTableInfo.mockReturnValueOnce(null);
    mockGetBlockquoteInfo.mockReturnValueOnce(null);
    mockGetListBlockBounds.mockReturnValueOnce(null);

    const result = getSourceBlockBounds(view);
    expect(result).toBeNull();
  });

  it("returns code fence content bounds", () => {
    const content = "```\ncode line 1\ncode line 2\n```";
    const view = createView(content, 5);

    mockGetCodeFenceInfo.mockReturnValueOnce({
      startLine: 1,
      endLine: 4,
    });

    const result = getSourceBlockBounds(view);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(view.state.doc.line(2).from);
    expect(result!.to).toBe(view.state.doc.line(3).to);
  });

  it("returns null for empty code fence", () => {
    const content = "```\n```";
    const view = createView(content, 1);

    mockGetCodeFenceInfo.mockReturnValueOnce({
      startLine: 1,
      endLine: 2,
    });

    const result = getSourceBlockBounds(view);
    expect(result).toBeNull();
  });

  it("returns table bounds", () => {
    const view = createView("| A | B |\n|---|---|\n| 1 | 2 |", 3);

    mockGetCodeFenceInfo.mockReturnValueOnce(null);
    mockGetSourceTableInfo.mockReturnValueOnce({
      start: 0,
      end: 29,
    });

    const result = getSourceBlockBounds(view);
    expect(result).toEqual({ from: 0, to: 29 });
  });

  it("returns blockquote bounds", () => {
    const view = createView("> quote line 1\n> quote line 2", 3);

    mockGetCodeFenceInfo.mockReturnValueOnce(null);
    mockGetSourceTableInfo.mockReturnValueOnce(null);
    mockGetBlockquoteInfo.mockReturnValueOnce({
      from: 0,
      to: 29,
    });

    const result = getSourceBlockBounds(view);
    expect(result).toEqual({ from: 0, to: 29 });
  });

  it("returns list block bounds", () => {
    const view = createView("- item 1\n- item 2", 3);

    mockGetCodeFenceInfo.mockReturnValueOnce(null);
    mockGetSourceTableInfo.mockReturnValueOnce(null);
    mockGetBlockquoteInfo.mockReturnValueOnce(null);
    mockGetListBlockBounds.mockReturnValueOnce({
      from: 0,
      to: 17,
    });

    const result = getSourceBlockBounds(view);
    expect(result).toEqual({ from: 0, to: 17 });
  });

  it("prioritizes code fence over table", () => {
    const view = createView("```\ncode\n```", 5);

    mockGetCodeFenceInfo.mockReturnValueOnce({
      startLine: 1,
      endLine: 3,
    });
    // Table mock should not be reached
    mockGetSourceTableInfo.mockReturnValueOnce({ start: 0, end: 10 });

    const result = getSourceBlockBounds(view);
    // Should return code fence bounds, not table
    expect(result).not.toBeNull();
    expect(mockGetSourceTableInfo).not.toHaveBeenCalled();
  });
});

describe("smart select-all (Mod-a)", () => {
  it("selects block content on first press", () => {
    const content = "- item 1\n- item 2";
    const docLength = content.length; // 17
    const view = createView(content, 3);

    const bindings = buildSourceShortcutKeymap();
    const modA = bindings.find((b) => b.key === "Mod-a");
    expect(modA).toBeDefined();

    // The Mod-a handler calls getSourceBlockBounds internally which calls
    // our mocked detection functions. We need the mocks to be stable
    // for every call during the handler execution.
    mockGetCodeFenceInfo.mockImplementation(() => null);
    mockGetSourceTableInfo.mockImplementation(() => null);
    mockGetBlockquoteInfo.mockImplementation(() => null);
    mockGetListBlockBounds.mockImplementation(() => ({ from: 0, to: docLength }));

    const handled = modA!.run!(view);

    // The handler should have expanded the selection to block bounds
    expect(handled).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(docLength);
  });

  it("selects the whole document when not in any block", () => {
    // Returning false here would invoke the browser's page-wide
    // selectAll and spread the highlight into the sidebar. The handler
    // must consume Cmd+A and select the full document instead.
    const content = "plain text without block structure";
    const view = createView(content, 5);

    mockGetCodeFenceInfo.mockReturnValue(null);
    mockGetSourceTableInfo.mockReturnValue(null);
    mockGetBlockquoteInfo.mockReturnValue(null);
    mockGetListBlockBounds.mockReturnValue(null);

    const bindings = buildSourceShortcutKeymap();
    const modA = bindings.find((b) => b.key === "Mod-a");

    const handled = modA!.run!(view);
    expect(handled).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(content.length);
  });

  it("expands to the whole document when entire block is already selected", () => {
    // Second Cmd+A in a block context should escalate to whole-document.
    // It must NOT return false (which would invoke the browser default
    // and leak the selection into the sidebar).
    const content = "- item 1\n- item 2";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = EditorState.create({
      doc: content,
      // Pre-select entire block (which here is also the whole document).
      selection: { anchor: 0, head: 17 },
    });
    const view = new EditorView({ state, parent });
    viewInstances.push(view);

    mockGetCodeFenceInfo.mockImplementation(() => null);
    mockGetSourceTableInfo.mockImplementation(() => null);
    mockGetBlockquoteInfo.mockImplementation(() => null);
    mockGetListBlockBounds.mockImplementation(() => ({ from: 0, to: 17 }));

    const bindings = buildSourceShortcutKeymap();
    const modA = bindings.find((b) => b.key === "Mod-a");

    const handled = modA!.run!(view);
    expect(handled).toBe(true);
    // Selection covers the whole document.
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(content.length);
  });
});

describe("smart select-all undo (Mod-z)", () => {
  it("restores previous selection after smart select-all", () => {
    const content = "- item 1\n- item 2";
    const view = createView(content, 3);

    mockGetCodeFenceInfo.mockImplementation(() => null);
    mockGetSourceTableInfo.mockImplementation(() => null);
    mockGetBlockquoteInfo.mockImplementation(() => null);
    mockGetListBlockBounds.mockImplementation(() => ({ from: 0, to: 17 }));

    const bindings = buildSourceShortcutKeymap();
    const modA = bindings.find((b) => b.key === "Mod-a");
    const modZ = bindings.find((b) => b.key === "Mod-z");

    // First: select all in block
    modA!.run!(view);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(17);

    // Then: undo should restore
    const handled = modZ!.run!(view);
    expect(handled).toBe(true);
    expect(view.state.selection.main.from).toBe(3);
    expect(view.state.selection.main.to).toBe(3);
  });

  it("returns false when no previous select-all", () => {
    const view = createView("text", 2);

    const bindings = buildSourceShortcutKeymap();
    const modZ = bindings.find((b) => b.key === "Mod-z");

    const handled = modZ!.run!(view);
    expect(handled).toBe(false);
  });

  it("returns false when selection was changed after select-all", () => {
    const content = "- item 1\n- item 2";
    const view = createView(content, 3);

    mockGetCodeFenceInfo.mockImplementation(() => null);
    mockGetSourceTableInfo.mockImplementation(() => null);
    mockGetBlockquoteInfo.mockImplementation(() => null);
    mockGetListBlockBounds.mockImplementation(() => ({ from: 0, to: 17 }));

    const bindings = buildSourceShortcutKeymap();
    const modA = bindings.find((b) => b.key === "Mod-a");
    const modZ = bindings.find((b) => b.key === "Mod-z");

    // Select all in block
    modA!.run!(view);

    // Manually change selection (simulates user moving cursor)
    view.dispatch({ selection: { anchor: 5 } });

    // Undo should not restore since selection changed
    const handled = modZ!.run!(view);
    expect(handled).toBe(false);
  });
});
