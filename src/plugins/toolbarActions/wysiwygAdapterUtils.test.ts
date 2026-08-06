import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

let mockActiveFilePath: string | null = null;
vi.mock("@/plugins/shared/hostDocument", () => ({
  hostDocument: {
    activeFilePath: vi.fn(() => null),
    activeHardBreakStyle: vi.fn(() => "unknown"),
  },
  // The guarded convenience the production code calls; same answer.
  activeFilePathForCurrentWindow: vi.fn(() => mockActiveFilePath),
}));

vi.mock("@/plugins/shared/hostSettings", () => ({
  hostSettings: {
    preserveLineBreaks: vi.fn(() => false),
    preserveBlankLines: vi.fn(() => true),
    hardBreakStyleOnSave: vi.fn(() => "twoSpaces"),
  },
}));

vi.mock("@/utils/linebreaks", () => ({
  resolveHardBreakStyle: vi.fn(() => "twoSpaces"),
}));

vi.mock("@/utils/markdownPipeline", () => ({
  parseMarkdown: vi.fn(),
  serializeMarkdown: vi.fn(),
}));

import {
  isViewConnected,
  getActiveFilePath,
  getSerializeOptions,
  shouldPreserveTwoSpaceBreaks,
  applyFullDocumentTransform,
} from "./wysiwygAdapterUtils";
import { hostDocument, activeFilePathForCurrentWindow } from "@/plugins/shared/hostDocument";
import { hostSettings } from "@/plugins/shared/hostSettings";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import type { WysiwygToolbarContext } from "./types";

describe("isViewConnected", () => {
  it("returns true when view.dom.isConnected is true", () => {
    const view = { dom: { isConnected: true } } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(view)).toBe(true);
  });

  it("returns false when view.dom.isConnected is false", () => {
    const view = { dom: { isConnected: false } } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(view)).toBe(false);
  });

  it("returns false when view.dom is null", () => {
    const view = { dom: null } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(view)).toBe(false);
  });

  it("returns false when accessing dom throws", () => {
    const view = {
      get dom() {
        throw new Error("destroyed");
      },
    } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(view)).toBe(false);
  });
});

describe("getActiveFilePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns file path when document exists", () => {
    mockActiveFilePath = "/test/file.md";

    expect(getActiveFilePath()).toBe("/test/file.md");
  });

  it("returns null when there is no document to resolve against", () => {
    // The host collapses "no tab", "no document" and "no path yet" into one
    // null — three cases that used to be mocked separately here and were
    // always the same answer from this side.
    mockActiveFilePath = null;

    expect(getActiveFilePath()).toBeNull();
  });

  it("returns null when the lookup throws", () => {
    vi.mocked(activeFilePathForCurrentWindow).mockImplementationOnce(() => {
      throw new Error("no window");
    });

    expect(getActiveFilePath()).toBeNull();
  });
});

describe("getSerializeOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hostDocument.activeHardBreakStyle).mockReturnValue("unknown");
    vi.mocked(hostSettings.preserveLineBreaks).mockReturnValue(true);
    vi.mocked(hostSettings.hardBreakStyleOnSave).mockReturnValue("backslash");
    vi.mocked(resolveHardBreakStyle).mockReturnValue("backslash");
  });

  it("returns preserveLineBreaks from settings", () => {
    const opts = getSerializeOptions();
    expect(opts.preserveLineBreaks).toBe(true);
  });

  it("returns hardBreakStyle from resolveHardBreakStyle", () => {
    const opts = getSerializeOptions();
    expect(opts.hardBreakStyle).toBe("backslash");
    expect(resolveHardBreakStyle).toHaveBeenCalledWith("unknown", "backslash");
  });

  it("handles a document with no detected style gracefully", () => {
    vi.mocked(hostDocument.activeHardBreakStyle).mockReturnValue("unknown");

    const opts = getSerializeOptions();
    expect(resolveHardBreakStyle).toHaveBeenCalledWith("unknown", "backslash");
    expect(opts).toHaveProperty("preserveLineBreaks");
    expect(opts).toHaveProperty("hardBreakStyle");
  });
});

describe("shouldPreserveTwoSpaceBreaks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hostDocument.activeHardBreakStyle).mockReturnValue("unknown");
    vi.mocked(hostSettings.preserveLineBreaks).mockReturnValue(true);
    vi.mocked(hostSettings.hardBreakStyleOnSave).mockReturnValue("backslash");
  });

  it("returns true when hardBreakStyle is twoSpaces", () => {
    vi.mocked(resolveHardBreakStyle).mockReturnValue("twoSpaces");
    expect(shouldPreserveTwoSpaceBreaks()).toBe(true);
  });

  it("returns false when hardBreakStyle is backslash", () => {
    vi.mocked(resolveHardBreakStyle).mockReturnValue("backslash");
    expect(shouldPreserveTwoSpaceBreaks()).toBe(false);
  });
});

describe("applyFullDocumentTransform", () => {
  function createMockContext(overrides?: Partial<WysiwygToolbarContext>): WysiwygToolbarContext {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const mockDoc = { content: { size: 100 }, nodeSize: 102 };
    const mockSchema = { nodes: { doc: {} } };

    return {
      surface: "wysiwyg",
      view: {
        state: {
          doc: mockDoc,
          tr: {
            replaceWith: vi.fn().mockReturnThis(),
            setMeta: vi.fn().mockReturnThis(),
          },
        },
        dispatch,
        focus,
      } as never,
      editor: {
        schema: mockSchema,
        state: { doc: mockDoc },
      } as never,
      context: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hostDocument.activeHardBreakStyle).mockReturnValue("unknown");
    vi.mocked(hostSettings.preserveLineBreaks).mockReturnValue(true);
    vi.mocked(hostSettings.hardBreakStyleOnSave).mockReturnValue("backslash");
    vi.mocked(resolveHardBreakStyle).mockReturnValue("twoSpaces");
  });

  it("returns false when editor is null", () => {
    const ctx = createMockContext({ editor: null });
    const result = applyFullDocumentTransform(ctx, (s) => s);
    expect(result).toBe(false);
  });

  it("returns false when view is null", () => {
    const ctx = createMockContext({ view: null });
    const result = applyFullDocumentTransform(ctx, (s) => s);
    expect(result).toBe(false);
  });

  it("returns true without dispatch when transform produces same content", () => {
    vi.mocked(serializeMarkdown).mockReturnValue("# Hello");
    const ctx = createMockContext();

    const result = applyFullDocumentTransform(ctx, (s) => s);

    expect(result).toBe(true);
    expect(ctx.view!.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches transaction when transform changes content", () => {
    vi.mocked(serializeMarkdown).mockReturnValue("# Hello");
    vi.mocked(parseMarkdown).mockReturnValue({ content: "new-content" } as never);
    const ctx = createMockContext();

    const transform = vi.fn((s: string) => s.toUpperCase());
    const result = applyFullDocumentTransform(ctx, transform);

    expect(result).toBe(true);
    expect(transform).toHaveBeenCalledWith("# Hello");
    expect(parseMarkdown).toHaveBeenCalled();
    expect(ctx.view!.dispatch).toHaveBeenCalled();
    expect(ctx.view!.focus).toHaveBeenCalled();
  });

  it("returns false and logs error when parseMarkdown throws", () => {
    vi.mocked(serializeMarkdown).mockReturnValue("original");
    vi.mocked(parseMarkdown).mockImplementation(() => {
      throw new Error("parse error");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = createMockContext();

    const result = applyFullDocumentTransform(ctx, () => "changed");

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
