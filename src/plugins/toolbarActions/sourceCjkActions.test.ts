import { vi, describe, it, expect } from "vitest";

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      getDocument: vi.fn(() => null),
      setLineMetadata: vi.fn(),
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

// WI-CJKF1.3 — only `normalizeLineEndings` is mocked, and only so the
// metadata-only assertion below can prove it is never called.
// `resolveHardBreakStyle` stays REAL: the old mock pinned it to "backslash",
// which silently disabled hard-break preservation for every case in this file,
// where the app resolves "unknown" + "preserve" to "twoSpaces".
//
// Nothing else is mocked either. This file used to `vi.mock` the whole of
// `@/lib/cjkFormatter`, which is precisely why the corruption WI-CJKF1.1 fixes
// survived here: a test that mocks its own subject cannot see the subject
// being wrong. The settings mock it carried also used keys that do not exist
// on `CJKFormattingSettings` (`spaceBetweenCjkAndAlpha`, `fullWidthPunctuation`)
// — undetectable, because tsconfig.json excludes test files from typechecking.
vi.mock("@/utils/linebreaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/linebreaks")>()),
  normalizeLineEndings: vi.fn((text: string, target: string) =>
    target === "crlf" ? text.replace(/\n/g, "\r\n") : text.replace(/\r\n/g, "\n")
  ),
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
import { DEFAULT_CJK_FORMATTING } from "@/lib/cjkFormatter/types";

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
    const result = formatCJKCurrentBlock(view, DEFAULT_CJK_FORMATTING);
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
  // WI-CJKF1.3 — this block asserted that every trailing run is removed. That
  // was only ever true because the old mock pinned `resolveHardBreakStyle` to
  // "backslash". With the real resolver, an unknown document under the
  // "preserve" default resolves to "twoSpaces", and a run of two or more
  // trailing spaces after real content is a hard BREAK — markdown syntax, not
  // junk whitespace. Removing it changes the rendered output.
  it("keeps a two-or-more-space run, because that is a hard break", () => {
    const view = createView("hello   \nworld  ", 0);
    const result = handleRemoveTrailingSpaces(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello   \nworld  ");
    view.destroy();
  });

  it("removes a single trailing space, which is never a hard break", () => {
    const view = createView("hello \nworld ", 0);
    handleRemoveTrailingSpaces(view);
    expect(view.state.doc.toString()).toBe("hello\nworld");
    view.destroy();
  });

  it("removes trailing whitespace from a blank line — nothing precedes it", () => {
    const view = createView("hello\n   \nworld", 0);
    handleRemoveTrailingSpaces(view);
    expect(view.state.doc.toString()).toBe("hello\n\nworld");
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
