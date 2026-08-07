// @vitest-environment node
vi.mock("@/utils/debug", () => ({
  wysiwygAdapterError: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies
vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      getDocument: vi.fn(() => ({ hardBreakStyle: "unknown" })),
      setLineMetadata: vi.fn(),
    })),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      cjkFormatting: { addSpaces: true, quoteStyle: "smart" },
      markdown: {
        preserveLineBreaks: false,
        hardBreakStyleOnSave: "twoSpaces",
      },
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

vi.mock("@/lib/cjkFormatter", () => ({
  collapseNewlines: vi.fn((s: string) => s.replace(/\n{3,}/g, "\n\n")),
  formatMarkdown: vi.fn((s: string) => `formatted:${s}`),
  formatSelection: vi.fn((s: string) => `sel-formatted:${s}`),
  removeTrailingSpaces: vi.fn((s: string) => s.replace(/ +$/gm, "")),
}));

vi.mock("@/utils/linebreaks", () => ({
  normalizeLineEndings: vi.fn((s: string, target: string) => target === "crlf" ? s.replace(/\n/g, "\r\n") : s.replace(/\r\n/g, "\n")),
  resolveHardBreakStyle: vi.fn(() => "twoSpaces"),
}));

vi.mock("@/utils/markdownPipeline", () => ({
  parseMarkdown: vi.fn((_schema: unknown, content: string) => ({ content: `parsed:${content}` })),
  serializeMarkdown: vi.fn(() => "# original markdown"),
}));

import {
  handleFormatCJK,
  handleFormatCJKFile,
  handleRemoveTrailingSpaces,
  handleCollapseBlankLines,
  handleLineEndings,
} from "./wysiwygAdapterCjk";
import { formatMarkdown } from "@/lib/cjkFormatter";
import { serializeMarkdown, parseMarkdown } from "@/utils/markdownPipeline";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import type { WysiwygToolbarContext } from "./types";

function createMockContext(opts?: {
  selectionEmpty?: boolean;
  selectedText?: string;
  depth?: number;
}): WysiwygToolbarContext {
  const selectionEmpty = opts?.selectionEmpty ?? true;
  const selectedText = opts?.selectedText ?? "hello world";
  const depth = opts?.depth ?? 1;

  const tr = {
    replaceWith: vi.fn().mockReturnThis(),
    setMeta: vi.fn().mockReturnThis(),
  };

  const dispatch = vi.fn();
  const focus = vi.fn();

  const blockNode = {
    nodeSize: 20,
    content: "mock-content",
  };

  const schema = {
    text: vi.fn((t: string) => ({ text: t })),
    nodes: {
      doc: { create: vi.fn((_attrs: unknown, child: unknown) => child) },
    },
  };

  const $from = {
    depth,
    node: vi.fn(() => blockNode),
    before: vi.fn(() => 5),
    after: vi.fn(() => 25),
  };
  // Formatting spans the top-level blocks from $from to $to, so both ends of
  // the selection resolve, and the doc can be walked to collect them.
  const $to = $from;
  const walkTopLevel = vi.fn((cb: (node: unknown, offset: number) => void) => cb(blockNode, 5));

  return {
    surface: "wysiwyg",
    view: {
      state: {
        selection: {
          $from,
          $to,
          from: 10,
          to: selectionEmpty ? 10 : 20,
          empty: selectionEmpty,
        },
        doc: {
          textBetween: vi.fn(() => selectedText),
          content: { size: 100 },
          nodesBetween: vi.fn(),
          forEach: walkTopLevel,
        },
        tr,
        schema,
      },
      dispatch,
      focus,
    } as never,
    editor: {
      schema,
      state: {
        selection: {
          $from,
          $to,
          from: 10,
          to: selectionEmpty ? 10 : 20,
          empty: selectionEmpty,
        },
        doc: { content: { size: 100 }, forEach: walkTopLevel },
      },
      commands: { focus },
    } as never,
    context: null,
  };
}

describe("handleFormatCJK", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const ctx = createMockContext();
    ctx.view = null;
    expect(handleFormatCJK(ctx)).toBe(false);
  });

  it("returns false when editor is null", () => {
    const ctx = createMockContext();
    ctx.editor = null;
    expect(handleFormatCJK(ctx)).toBe(false);
  });

  it("uses mark-safe path (not schema.text) for selection formatting", () => {
    // Bug: old code used schema.text(formatted) which destroys all marks (bold, italic, links)
    // Fix: selection formatting should go through markdown roundtrip (handleFormatCJKBlock or handleFormatCJKFile)
    const ctx = createMockContext({ selectionEmpty: false, selectedText: "hello世界" });

    // The fix routes through markdown roundtrip — so formatMarkdown should be called, not formatSelection+schema.text
    vi.mocked(serializeMarkdown).mockReturnValue("**bold**世界");
    vi.mocked(formatMarkdown).mockReturnValue("**bold** 世界");
    vi.mocked(parseMarkdown).mockReturnValue({ content: "parsed" } as never);

    const result = handleFormatCJK(ctx);
    expect(result).toBe(true);
    // schema.text should NOT be called — that's the mark-destroying path
    expect(ctx.editor!.schema.text).not.toHaveBeenCalled();
  });

  it("does not dispatch when formatted text is unchanged", () => {
    const ctx = createMockContext({ selectionEmpty: false, selectedText: "already formatted" });

    // After fix, selection path uses markdown roundtrip
    vi.mocked(serializeMarkdown).mockReturnValue("already formatted");
    vi.mocked(formatMarkdown).mockReturnValue("already formatted");

    const result = handleFormatCJK(ctx);
    expect(result).toBe(true);
    expect(ctx.view!.dispatch).not.toHaveBeenCalled();
  });

  it("falls back to block formatting when selection is empty", () => {
    const ctx = createMockContext({ selectionEmpty: true });

    // Block formatting path: serializes block, formats, parses back
    vi.mocked(serializeMarkdown).mockReturnValue("block content");
    vi.mocked(parseMarkdown).mockReturnValue({ content: "parsed" } as never);

    const result = handleFormatCJK(ctx);
    expect(result).toBe(true);
  });

  it("falls back to whole-document formatting at depth 0 (select-all)", () => {
    // Depth 0 means an AllSelection or a NodeSelection on the doc: there is no
    // top-level block to span, and "format everything" is what the user asked
    // for anyway.
    const ctx = createMockContext({ selectionEmpty: true, depth: 0 });
    vi.mocked(serializeMarkdown).mockReturnValue("doc content");
    vi.mocked(parseMarkdown).mockReturnValue({ content: "parsed" } as never);
    expect(handleFormatCJK(ctx)).toBe(true);
  });

  it("returns false and logs error when block serialization throws", async () => {
    const ctx = createMockContext({ selectionEmpty: true });
    const debug = await import("@/utils/debug");

    vi.mocked(serializeMarkdown).mockImplementation(() => {
      throw new Error("serialize failed");
    });

    const result = handleFormatCJK(ctx);
    expect(result).toBe(false);
    expect(vi.mocked(debug.wysiwygAdapterError)).toHaveBeenCalledWith(
      expect.stringContaining("Failed to format CJK block"),
      expect.any(Error),
    );
  });
});

describe("handleFormatCJKBlock — early return when formatted === original (line 85)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true without dispatching when block markdown is unchanged after format", () => {
    const ctx = createMockContext({ selectionEmpty: true });

    // formatMarkdown returns the same string → early return at line 85
    vi.mocked(serializeMarkdown).mockReturnValue("already clean content");
    vi.mocked(formatMarkdown).mockReturnValue("already clean content");

    const result = handleFormatCJK(ctx);
    expect(result).toBe(true);
    // dispatch should NOT be called since formatted === blockMarkdown
    expect(ctx.view!.dispatch).not.toHaveBeenCalled();
  });
});

describe("handleFormatCJKFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const ctx = createMockContext();
    ctx.editor = null;
    expect(handleFormatCJKFile(ctx)).toBe(false);
  });

  it("returns false when view is null", () => {
    const ctx = createMockContext();
    ctx.view = null;
    expect(handleFormatCJKFile(ctx)).toBe(false);
  });

  it("applies formatMarkdown transform to full document", () => {
    const ctx = createMockContext();
    vi.mocked(serializeMarkdown).mockReturnValue("original");
    vi.mocked(parseMarkdown).mockReturnValue({ content: "new" } as never);

    const result = handleFormatCJKFile(ctx);
    expect(result).toBe(true);
  });
});

describe("handleRemoveTrailingSpaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const ctx = createMockContext();
    ctx.editor = null;
    expect(handleRemoveTrailingSpaces(ctx)).toBe(false);
  });

  it("applies removeTrailingSpaces transform", () => {
    const ctx = createMockContext();
    vi.mocked(serializeMarkdown).mockReturnValue("hello   ");
    vi.mocked(parseMarkdown).mockReturnValue({ content: "new" } as never);

    const result = handleRemoveTrailingSpaces(ctx);
    expect(result).toBe(true);
  });
});

describe("handleCollapseBlankLines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const ctx = createMockContext();
    ctx.editor = null;
    expect(handleCollapseBlankLines(ctx)).toBe(false);
  });

  it("applies collapseNewlines transform", () => {
    const ctx = createMockContext();
    vi.mocked(serializeMarkdown).mockReturnValue("a\n\n\nb");
    vi.mocked(parseMarkdown).mockReturnValue({ content: "new" } as never);

    const result = handleCollapseBlankLines(ctx);
    expect(result).toBe(true);
  });
});

describe("handleLineEndings is METADATA-ONLY (WI-1.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The old implementation round-tripped the whole document through
  // normalizeLineEndings. On WYSIWYG that put literal `\r` characters INTO the
  // ProseMirror text nodes — remark preserves `\r\n` inside a paragraph — which
  // is the LF-invariant violation shipped as a feature. Line endings are
  // METADATA; the convention is applied at save time by `saveToPath`.

  it("never touches the editor: no serialize, no parse, no dispatch", () => {
    const setLineMetadata = vi.fn();
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ hardBreakStyle: "unknown" })),
      setLineMetadata,
    } as never);

    const ctx = createMockContext();
    const result = handleLineEndings(ctx, "crlf");

    expect(result).toBe(true);
    expect(serializeMarkdown).not.toHaveBeenCalled();
    expect(parseMarkdown).not.toHaveBeenCalled();
    expect(ctx.view?.dispatch).not.toHaveBeenCalled();
  });

  it.each(["lf", "crlf"] as const)("records %s in store metadata", (target) => {
    const setLineMetadata = vi.fn();
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ hardBreakStyle: "unknown" })),
      setLineMetadata,
    } as never);

    const ctx = createMockContext();
    expect(handleLineEndings(ctx, target)).toBe(true);
    expect(setLineMetadata).toHaveBeenCalledWith("tab-1", { lineEnding: target });
  });

  it("returns false when no active tab — nothing happened, so say so", () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ hardBreakStyle: "unknown" })),
      setLineMetadata: vi.fn(),
    } as never);

    // No active tab
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: {},
    } as never);

    const ctx = createMockContext();
    expect(handleLineEndings(ctx, "lf")).toBe(false);
  });
});
