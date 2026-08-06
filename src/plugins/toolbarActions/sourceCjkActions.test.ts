import { vi, describe, it, expect } from "vitest";

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      getDocument: vi.fn(() => null),
      setLineMetadata: vi.fn(),
    })),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      cjkFormatting: {
        spaceBetweenCjkAndAlpha: true,
        spaceBetweenCjkAndDigit: true,
        fullWidthPunctuation: false,
      },
      markdown: { hardBreakStyleOnSave: "backslash" },
    })),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(() => ({
      activeTabId: { main: "tab-1" },
    })),
  },
}));

vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/lib/cjkFormatter", () => ({
  formatMarkdown: vi.fn((text: string) => text.replace(/你好world/g, "你好 world")),
  formatSelection: vi.fn((text: string) => text.replace(/你好world/g, "你好 world")),
  removeTrailingSpaces: vi.fn((text: string) => text.replace(/ +$/gm, "")),
  collapseNewlines: vi.fn((text: string) => text.replace(/\n{3,}/g, "\n\n")),
}));

vi.mock("@/utils/linebreaks", () => ({
  normalizeLineEndings: vi.fn((text: string, target: string) =>
    target === "crlf" ? text.replace(/\n/g, "\r\n") : text.replace(/\r\n/g, "\n")
  ),
  resolveHardBreakStyle: vi.fn(() => "backslash"),
}));

vi.mock("@/utils/sourceSelection", () => ({
  getSourceBlockRange: vi.fn((_state: unknown, from: number, to: number) => ({ from, to: to + 10 })),
}));

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  handleFormatCJK,
  formatCJKCurrentBlock,
  handleFormatCJKFile,
  handleRemoveTrailingSpaces,
  handleCollapseBlankLines,
  handleLineEndings,
} from "./sourceCjkActions";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { normalizeLineEndings } from "@/utils/linebreaks";

function createView(doc: string, from: number, to?: number): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to ?? from),
  });
  return new EditorView({ state, parent });
}

describe("handleFormatCJK", () => {
  it("formats selected text when selection exists", () => {
    const view = createView("你好world", 0, 7);
    const result = handleFormatCJK(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("你好 world");
    view.destroy();
  });

  it("preserves selection after formatting", () => {
    const view = createView("你好world", 0, 7);
    handleFormatCJK(view);
    const sel = view.state.selection.main;
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(8); // "你好 world" is 8 chars
    view.destroy();
  });

  it("does nothing when formatted text equals original", () => {
    const view = createView("already fine", 0, 12);
    const result = handleFormatCJK(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("already fine");
    view.destroy();
  });

  it("returns true even with no selection (block format)", () => {
    const view = createView("some text", 4);
    const result = handleFormatCJK(view);
    expect(result).toBe(true);
    view.destroy();
  });
});

describe("formatCJKCurrentBlock", () => {
  it("formats the current block text", () => {
    const view = createView("你好world extra", 4);
    const config = {
      spaceBetweenCjkAndAlpha: true,
      spaceBetweenCjkAndDigit: true,
      fullWidthPunctuation: false,
    };
    const result = formatCJKCurrentBlock(view, config);
    expect(result).toBe(true);
    view.destroy();
  });
});

describe("handleFormatCJKFile", () => {
  it("formats entire document content", () => {
    const view = createView("你好world\n你好world", 0);
    const result = handleFormatCJKFile(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("你好 world\n你好 world");
    view.destroy();
  });

  it("preserves cursor position clamped to new length", () => {
    const view = createView("你好world", 5);
    handleFormatCJKFile(view);
    const cursor = view.state.selection.main.head;
    expect(cursor).toBeLessThanOrEqual(view.state.doc.length);
    view.destroy();
  });

  it("does nothing when content is already formatted", () => {
    const view = createView("already fine", 0);
    const result = handleFormatCJKFile(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("already fine");
    view.destroy();
  });
});

describe("handleRemoveTrailingSpaces", () => {
  it("removes trailing spaces from each line", () => {
    const view = createView("hello   \nworld  ", 0);
    const result = handleRemoveTrailingSpaces(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\nworld");
    view.destroy();
  });

  it("does nothing when no trailing spaces exist", () => {
    const view = createView("hello\nworld", 0);
    const result = handleRemoveTrailingSpaces(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\nworld");
    view.destroy();
  });

  it("preserves cursor position clamped to document length", () => {
    const view = createView("hello   ", 8);
    handleRemoveTrailingSpaces(view);
    const cursor = view.state.selection.main.head;
    expect(cursor).toBeLessThanOrEqual(view.state.doc.length);
    view.destroy();
  });
});

describe("handleCollapseBlankLines", () => {
  it("collapses triple+ newlines to double newlines", () => {
    const view = createView("hello\n\n\nworld", 0);
    const result = handleCollapseBlankLines(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\n\nworld");
    view.destroy();
  });

  it("does nothing when no triple newlines exist", () => {
    const view = createView("hello\n\nworld", 0);
    const result = handleCollapseBlankLines(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\n\nworld");
    view.destroy();
  });
});

describe("handleLineEndings is METADATA-ONLY (WI-1.7)", () => {
  // Line endings are METADATA in this app — the buffer is LF-canonical and the
  // convention is applied at save time. The old implementation round-tripped
  // the whole document through normalizeLineEndings anyway, which on Source was
  // a pure waste (CodeMirror normalises CRLF back to LF on insert) with two
  // real side effects: an undo entry that restores nothing, and a collapsed
  // selection. On WYSIWYG it was worse — the CR survived into PM text nodes.

  it("does not touch the buffer, the undo history, or the selection", async () => {
    const { history, undoDepth } = await import("@codemirror/commands");
    const parent = document.createElement("div");
    const state = EditorState.create({
      doc: "hello\nworld",
      selection: EditorSelection.single(2, 8),
      extensions: [history()],
    });
    const view = new EditorView({ state, parent });

    const result = handleLineEndings(view, "crlf");

    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\nworld");
    expect(undoDepth(view.state)).toBe(0);
    const range = view.state.selection.main;
    expect([range.from, range.to]).toEqual([2, 8]);
    view.destroy();
  });

  it("does not call normalizeLineEndings at all — there is no text transform", () => {
    vi.mocked(normalizeLineEndings).mockClear();
    const view = createView("hello\r\nworld", 0);
    handleLineEndings(view, "lf");
    expect(normalizeLineEndings).not.toHaveBeenCalled();
    view.destroy();
  });

  it("updates document metadata in store", () => {
    const setLineMetadata = vi.fn();
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => null),
      setLineMetadata,
    } as never);

    const view = createView("hello\nworld", 0);
    handleLineEndings(view, "crlf");
    expect(setLineMetadata).toHaveBeenCalledWith("tab-1", { lineEnding: "crlf" });
    view.destroy();
  });

  it("returns false when no active tab — nothing happened, so say so", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: null },
    } as never);

    const setLineMetadata = vi.fn();
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => null),
      setLineMetadata,
    } as never);

    const view = createView("hello\nworld", 0);
    expect(handleLineEndings(view, "lf")).toBe(false);
    expect(setLineMetadata).not.toHaveBeenCalled();
    view.destroy();
  });
});
