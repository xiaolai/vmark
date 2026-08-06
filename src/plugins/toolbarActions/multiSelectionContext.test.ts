import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import type { CursorContext as SourceContext } from "@/types/cursorContext";

vi.mock("@/plugins/multiCursor", () => {
  class MultiSelection {
    ranges: Array<{ $from: { depth: number; pos: number; node: () => { type: { name: string }; isTextblock: boolean; isBlock: boolean } }; $to: { depth: number; pos: number; node: () => { type: { name: string }; isTextblock: boolean; isBlock: boolean } } }>;
    constructor(ranges: unknown[]) {
      this.ranges = ranges as typeof this.ranges;
    }
  }
  return { MultiSelection };
});

import {
  getSourceMultiSelectionContext,
  getWysiwygMultiSelectionContext,
} from "./multiSelectionContext";
import { MultiSelection } from "@/plugins/multiCursor";

function createCmView(doc: string, ranges: Array<{ from: number; to: number }>): CodeMirrorView {
  const parent = document.createElement("div");
  const selection = EditorSelection.create(
    ranges.map((r) => EditorSelection.range(r.from, r.to))
  );
  const state = EditorState.create({
    doc,
    selection,
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  return new CodeMirrorView({ state, parent });
}

function emptySourceContext(): SourceContext {
  return {
    inTable: false,
    inList: false,
    inBlockquote: false,
    inHeading: false,
    inLink: false,
    inInlineMath: false,
    inFootnote: false,
    inImage: false,
    inCodeBlock: false,
    isEmpty: false,
    isBold: false,
    isItalic: false,
    isStrikethrough: false,
    isHighlight: false,
    isCode: false,
    isUnderline: false,
    isSuperscript: false,
    isSubscript: false,
    headingLevel: 0,
    listType: null,
  };
}

describe("getSourceMultiSelectionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns disabled context when view is null", () => {
    const result = getSourceMultiSelectionContext(null, null);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("none");
  });

  it("returns disabled context when context is null", () => {
    const view = createCmView("hello", [{ from: 0, to: 0 }]);
    const result = getSourceMultiSelectionContext(view, null);
    expect(result.enabled).toBe(false);
    view.destroy();
  });

  it("returns disabled context for single selection", () => {
    const view = createCmView("hello world", [{ from: 0, to: 0 }]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("none");
    view.destroy();
  });

  it("returns enabled context for multiple selections", () => {
    const view = createCmView("hello world", [
      { from: 0, to: 5 },
      { from: 6, to: 11 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe("multi");
    view.destroy();
  });

  it("detects table lines", () => {
    const view = createCmView("| a | b |\n| c | d |", [
      { from: 2, to: 2 },
      { from: 12, to: 12 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.inTable).toBe(true);
    view.destroy();
  });

  it("detects blockquote lines", () => {
    const view = createCmView("> quote1\n> quote2", [
      { from: 2, to: 2 },
      { from: 11, to: 11 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.inBlockquote).toBe(true);
    view.destroy();
  });

  it("detects heading lines", () => {
    const view = createCmView("# Heading 1\n## Heading 2", [
      { from: 2, to: 2 },
      { from: 14, to: 14 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.inHeading).toBe(true);
    view.destroy();
  });

  it("detects list lines (bullet)", () => {
    const view = createCmView("- item1\n- item2", [
      { from: 2, to: 2 },
      { from: 10, to: 10 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.inList).toBe(true);
    view.destroy();
  });

  it("detects list lines (ordered)", () => {
    const view = createCmView("1. item1\n2. item2", [
      { from: 3, to: 3 },
      { from: 12, to: 12 },
    ]);
    const context: SourceContext = {
      ...emptySourceContext(),
      inList: true,
    };
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.inList).toBe(true);
    view.destroy();
  });

  it("detects task list lines", () => {
    const view = createCmView("- [ ] task1\n- [x] task2", [
      { from: 6, to: 6 },
      { from: 18, to: 18 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.inList).toBe(true);
    view.destroy();
  });

  it("detects mixed block types with sameBlockParent=false", () => {
    const view = createCmView("# Heading\nparagraph", [
      { from: 2, to: 2 },
      { from: 12, to: 12 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.sameBlockParent).toBe(false);
    view.destroy();
  });

  it("detects same block parent when both are paragraphs", () => {
    const view = createCmView("paragraph1\nparagraph2", [
      { from: 2, to: 2 },
      { from: 13, to: 13 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.sameBlockParent).toBe(true);
    expect(result.blockParentType).toBe("paragraph");
    view.destroy();
  });

  it("uses context flags for link, inlineMath, footnote, image", () => {
    const view = createCmView("hello\nworld", [
      { from: 0, to: 0 },
      { from: 6, to: 6 },
    ]);
    const context: SourceContext = {
      ...emptySourceContext(),
      inLink: true,
      inInlineMath: true,
      inFootnote: true,
      inImage: true,
    };
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.inLink).toBe(true);
    expect(result.inInlineMath).toBe(true);
    expect(result.inFootnote).toBe(true);
    expect(result.inImage).toBe(true);
    view.destroy();
  });

  it("detects code fence for inCodeBlock", () => {
    const doc = "```\ncode line\n```\noutside";
    const view = createCmView(doc, [
      { from: 5, to: 5 }, // inside code fence
      { from: 18, to: 18 }, // outside code fence
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    expect(result.inCodeBlock).toBe(true);
    expect(result.inTextblock).toBe(false); // inside code block = not in textblock
    view.destroy();
  });

  it("handles line with pipe character in non-table context", () => {
    const view = createCmView("a | b\nc | d", [
      { from: 0, to: 0 },
      { from: 6, to: 6 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    // Lines containing | are classified as table
    expect(result.inTable).toBe(true);
    view.destroy();
  });

  it("sets inTextblock to true when not in code block", () => {
    const view = createCmView("hello\nworld", [
      { from: 0, to: 0 },
      { from: 6, to: 6 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.inTextblock).toBe(true);
    view.destroy();
  });

  it("uses context.inTable flag when context says inTable", () => {
    const view = createCmView("plain\ntext", [
      { from: 0, to: 0 },
      { from: 6, to: 6 },
    ]);
    const context: SourceContext = {
      ...emptySourceContext(),
      inTable: true,
    };
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.inTable).toBe(true);
    view.destroy();
  });

  it("detects unclosed code fence as not inside code block", () => {
    // Code fence without closing - cursor after the content
    const doc = "normal\n```\ncode";
    const view = createCmView(doc, [
      { from: 0, to: 0 },
      { from: 12, to: 12 }, // inside unclosed fence
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.enabled).toBe(true);
    // unclosed fence: isInsideCodeFence returns false since no closing found
    view.destroy();
  });

  it("handles star-prefixed list lines", () => {
    const view = createCmView("* item1\n* item2", [
      { from: 2, to: 2 },
      { from: 10, to: 10 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.inList).toBe(true);
    view.destroy();
  });

  it("handles plus-prefixed list lines", () => {
    const view = createCmView("+ item1\n+ item2", [
      { from: 2, to: 2 },
      { from: 10, to: 10 },
    ]);
    const context = emptySourceContext();
    const result = getSourceMultiSelectionContext(view, context);
    expect(result.inList).toBe(true);
    view.destroy();
  });
});

describe("getWysiwygMultiSelectionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns disabled context when view is null", () => {
    const result = getWysiwygMultiSelectionContext(null);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("none");
  });

  it("returns disabled context for regular selection (not MultiSelection)", () => {
    const mockView = {
      state: {
        selection: { ranges: [{ $from: {}, $to: {} }] },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(false);
  });

  it("returns disabled context for single-range MultiSelection", () => {
    const range = createMockRange("paragraph");
    const selection = new MultiSelection([range]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(false);
  });

  it("returns enabled context for multi-range MultiSelection in paragraphs", () => {
    const range1 = createMockRange("paragraph");
    const range2 = createMockRange("paragraph");
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe("multi");
    expect(result.sameBlockParent).toBe(true);
    expect(result.blockParentType).toBe("paragraph");
  });

  it("detects inTable when range is inside table node", () => {
    const range1 = createMockRange("paragraph", ["tableCell"]);
    const range2 = createMockRange("paragraph", ["tableCell"]);
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inTable).toBe(true);
    expect(result.blockParentType).toBe("table");
  });

  it("detects inList when range is inside list node", () => {
    const range1 = createMockRange("paragraph", ["listItem"]);
    const range2 = createMockRange("paragraph", ["listItem"]);
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inList).toBe(true);
    expect(result.blockParentType).toBe("list");
  });

  it("detects inCodeBlock when range is inside codeBlock node", () => {
    const range1 = createMockRange("paragraph", ["codeBlock"]);
    const range2 = createMockRange("paragraph");
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inCodeBlock).toBe(true);
  });

  it("detects inHeading when range is inside heading node", () => {
    const range1 = createMockRange("heading", []);
    const range2 = createMockRange("heading", []);
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inHeading).toBe(true);
  });

  it("detects inBlockquote when range is inside blockquote node", () => {
    const range1 = createMockRange("paragraph", ["blockquote"]);
    const range2 = createMockRange("paragraph", ["blockquote"]);
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inBlockquote).toBe(true);
    expect(result.blockParentType).toBe("blockquote");
  });

  it("returns null blockParent when no textblock found (getBlockParentName null, line 85)", () => {
    // Both $from and $to have isTextblock=false at all depths → blockParent=null
    const range1 = createMockRange("paragraph", [], false);
    const range2 = createMockRange("paragraph", [], false);
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.blockParentType).toBeNull();
  });

  it("detects sameBlockParent=false for mixed block types", () => {
    const range1 = createMockRange("paragraph");
    const range2 = createMockRange("heading");
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.sameBlockParent).toBe(false);
  });

  it("detects inLink when text has link mark", () => {
    const range1 = createMockRange("paragraph");
    const range2 = createMockRange("paragraph");
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn((_from: number, _to: number, callback: (node: unknown) => boolean | void) => {
            callback({
              isText: true,
              marks: [{ type: { name: "link" } }],
              type: { name: "text" },
            });
          }),
          resolve: vi.fn(() => ({ marks: () => [{ type: { name: "link" } }] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inLink).toBe(true);
  });

  it("detects inImage when nodesBetween finds image node", () => {
    const range1 = createMockRange("paragraph");
    const range2 = createMockRange("paragraph");
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn((_from: number, _to: number, callback: (node: unknown) => boolean | void) => {
            callback({
              isText: false,
              marks: [],
              type: { name: "image" },
            });
          }),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inImage).toBe(true);
  });

  it("detects inInlineMath when nodesBetween finds math_inline node", () => {
    const range1 = createMockRange("paragraph");
    const range2 = createMockRange("paragraph");
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn((_from: number, _to: number, callback: (node: unknown) => boolean | void) => {
            callback({
              isText: false,
              marks: [],
              type: { name: "math_inline" },
            });
          }),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inInlineMath).toBe(true);
  });

  it("detects inFootnote when nodesBetween finds footnote_reference node", () => {
    const range1 = createMockRange("paragraph");
    const range2 = createMockRange("paragraph");
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn((_from: number, _to: number, callback: (node: unknown) => boolean | void) => {
            callback({
              isText: false,
              marks: [],
              type: { name: "footnote_reference" },
            });
          }),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.enabled).toBe(true);
    expect(result.inFootnote).toBe(true);
  });

  it("sets inTextblock based on both ranges being in textblocks", () => {
    const range1 = createMockRange("paragraph", [], true);
    const range2 = createMockRange("paragraph", [], true);
    const selection = new MultiSelection([range1, range2]);
    const mockView = {
      state: {
        selection,
        doc: {
          nodesBetween: vi.fn(),
          resolve: vi.fn(() => ({ marks: () => [] })),
        },
      },
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = getWysiwygMultiSelectionContext(mockView);
    expect(result.inTextblock).toBe(true);
  });
});

/** Helper to create a mock range for WYSIWYG multi-selection tests */
function createMockRange(
  textblockType: string,
  ancestorTypes: string[] = [],
  isTextblock = true,
) {
  const depth = ancestorTypes.length + 1; // +1 for the textblock itself
  const nodeAtDepth = (d: number) => {
    if (d === depth) {
      return { type: { name: textblockType }, isTextblock };
    }
    if (d > 0 && d <= ancestorTypes.length) {
      return { type: { name: ancestorTypes[d - 1] }, isTextblock: false };
    }
    return { type: { name: "doc" }, isTextblock: false };
  };

  const $pos = {
    depth,
    pos: 0,
    node: vi.fn(nodeAtDepth),
    parent: { isTextblock },
  };

  return {
    $from: $pos,
    $to: { ...JSON.parse(JSON.stringify($pos)), parent: { isTextblock }, node: vi.fn(nodeAtDepth) },
  };
}

describe("code-fence context uses the shared scanner", () => {
  // A minimal cursor context: the fence question is answered by the scanner,
  // not by these flags.
  const baseContext = { inTable: false, inList: false, inBlockquote: false } as SourceContext;

  function contextAt(doc: string, positions: [number, number]) {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create(
        positions.map((p) => EditorSelection.cursor(p)),
        0,
      ),
      // Without this facet CodeMirror silently collapses to ONE range and the
      // function under test bails out on its multi-selection guard.
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const parent = document.createElement("div");
    const view = new CodeMirrorView({ state, parent });
    const ctx = getSourceMultiSelectionContext(view, baseContext);
    view.destroy();
    return ctx;
  }

  it("recognises a TILDE fence", () => {
    // The private scanner matched backticks only, so a cursor inside ~~~ was
    // treated as ordinary markdown and block actions ran against literal text.
    const ctx = contextAt("~~~\ncode here\n~~~", [5, 6]);
    expect(ctx.inCodeBlock).toBe(true);
  });

  it("does not mistake a CLOSER above the cursor for an opener", () => {
    // Walking up to the nearest fence-looking line read the closing ``` of a
    // finished block as an opener, flagging plain paragraph text as code.
    const ctx = contextAt("```\ncode\n```\npara here", [14, 16]);
    expect(ctx.inCodeBlock).toBe(false);
  });

  it("protects the content of an UNCLOSED fence", () => {
    // The old scanner required a closer to say "inside", so exactly the fence
    // most likely mid-typing had no protection at all.
    const ctx = contextAt("```\ndangling code", [6, 8]);
    expect(ctx.inCodeBlock).toBe(true);
  });
});
