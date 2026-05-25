/**
 * sourceShortcutsHelpers Tests
 *
 * Tests for formatCJKFile ensuring it uses view.dispatch() (undo-friendly)
 * instead of store.setContent().
 */

import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";

// Mock all store dependencies before importing the module under test
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      cjkFormatting: {},
      markdown: { hardBreakStyleOnSave: "backslash" },
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: () => ({ hardBreakStyle: "unknown" }),
      setContent: vi.fn(),
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

vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: () => "main",
}));

vi.mock("@/utils/linebreaks", () => ({
  resolveHardBreakStyle: () => "backslash",
}));

// Mock formatMarkdown to return a predictable transformation
vi.mock("@/lib/cjkFormatter", () => ({
  formatMarkdown: (content: string) => content.replace(/hello/g, "HELLO"),
  formatSelection: (content: string) => content,
}));

vi.mock("@/stores/searchStore", () => ({
  useUIStore: { getState: () => ({}) },
}));

vi.mock("@/stores/sourceCursorContextStore", () => ({
  useSourceCursorContextStore: { getState: () => ({ context: {} }) },
}));

vi.mock("@/plugins/toolbarActions/sourceAdapter", () => ({
  performSourceToolbarAction: vi.fn(),
  setSourceHeadingLevel: vi.fn(),
  formatCJKCurrentBlock: vi.fn(),
}));

vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getSourceMultiSelectionContext: () => ({}),
}));

vi.mock("@/plugins/sourceContextDetection/headingDetection", () => ({
  getHeadingInfo: () => null,
  setHeadingLevel: vi.fn(),
  convertToHeading: vi.fn(),
}));

vi.mock("@/plugins/sourceContextDetection/listDetection", () => ({
  getListItemInfo: () => null,
  toBulletList: vi.fn(),
  toOrderedList: vi.fn(),
  toTaskList: vi.fn(),
  removeList: vi.fn(),
}));

vi.mock("@/plugins/sourceContextDetection/blockquoteActions", () => ({
  toggleBlockquote: vi.fn(),
}));

vi.mock("@/utils/textTransformations", () => ({
  toUpperCase: (s: string) => s,
  toLowerCase: (s: string) => s,
  toTitleCase: (s: string) => s,
  toggleCase: (s: string) => s,
  moveLinesUp: () => null,
  moveLinesDown: () => null,
  duplicateLines: () => ({ newText: "", newFrom: 0, newTo: 0 }),
  deleteLines: () => ({ newText: "", newCursor: 0 }),
  joinLines: () => ({ newText: "", newFrom: 0, newTo: 0 }),
  sortLinesAscending: () => ({ newText: "", newFrom: 0, newTo: 0 }),
  sortLinesDescending: () => ({ newText: "", newFrom: 0, newTo: 0 }),
}));

vi.mock("@/export", () => ({
  copyAsHtml: vi.fn(),
}));

import { formatCJKFile } from "../sourceShortcutsHelpers";

function createView(content: string, withHistory = false): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: 0 },
    extensions: withHistory ? [history()] : [],
  });
  return new EditorView({
    state,
    parent: document.createElement("div"),
  });
}

describe("formatCJKFile", () => {
  it("dispatches change to editor (undo-friendly)", () => {
    const view = createView("hello world");
    formatCJKFile(view);

    // The mock transforms "hello" -> "HELLO"
    expect(view.state.doc.toString()).toBe("HELLO world");
    view.destroy();
  });

  it("change is in undo stack", () => {
    const view = createView("hello world", true);
    formatCJKFile(view);
    expect(view.state.doc.toString()).toBe("HELLO world");

    // Undo should revert to original
    undo(view);
    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });

  it("does not dispatch when content is unchanged", () => {
    const view = createView("no match here");
    const dispatchSpy = vi.spyOn(view, "dispatch");
    formatCJKFile(view);

    // formatMarkdown mock only replaces "hello", so "no match here" is unchanged
    expect(dispatchSpy).not.toHaveBeenCalled();
    view.destroy();
  });
});
