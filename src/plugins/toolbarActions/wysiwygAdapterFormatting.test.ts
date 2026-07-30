import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/plugins/formatToolbar/nodeActions.tiptap", () => ({
  handleRemoveBlockquote: vi.fn(),
}));

vi.mock("@/plugins/multiCursor", () => ({
  MultiSelection: class MockMultiSelection {},
}));

vi.mock("@/utils/textTransformations", () => ({
  toUpperCase: vi.fn((s: string) => s.toUpperCase()),
  toLowerCase: vi.fn((s: string) => s.toLowerCase()),
  toTitleCase: vi.fn((s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())),
  toggleCase: vi.fn((s: string) =>
    [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("")
  ),
}));

vi.mock("@/lib/cjkFormatter/quoteToggle", () => ({
  computeQuoteToggle: vi.fn(),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      cjkFormatting: {
        quoteToggleMode: "toggle",
        quoteStyle: "smart",
      },
    })),
  },
}));

import {
  clearFormattingInView,
  toggleBlockquote,
  handleWysiwygTransformCase,
  toggleQuoteStyleAtCursor,
} from "./wysiwygAdapterFormatting";
import { getCurrentHeadingLevel, increaseHeadingLevel, decreaseHeadingLevel } from "./wysiwygHeadingLevel";
import { handleRemoveBlockquote } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { computeQuoteToggle } from "@/lib/cjkFormatter/quoteToggle";
import { MultiSelection } from "@/plugins/multiCursor";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { WysiwygToolbarContext } from "./types";

// ---------- clearFormattingInView — MultiSelection branch (line 29) ----------

describe("clearFormattingInView — MultiSelection branch (line 29)", () => {
  it("uses MultiSelection ranges when selection is a MultiSelection instance", () => {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const removeMark = vi.fn().mockReturnThis();

    const marks = [{ type: { name: "bold" } }];
    const tr = { removeMark, docChanged: true };

    const nodesBetween = vi.fn((_from: number, _to: number, cb: (node: Record<string, unknown>, pos: number) => void) => {
      cb({ isText: true, marks, text: "hello", nodeSize: 5 }, 5);
    });

    // Build a selection that is instanceof MockMultiSelection (the mocked class)
    const multiSel = Object.create(MultiSelection.prototype) as {
      ranges: Array<{ $from: { pos: number }; $to: { pos: number } }>;
    };
    multiSel.ranges = [
      { $from: { pos: 5 }, $to: { pos: 10 } },
      { $from: { pos: 15 }, $to: { pos: 20 } },
    ];

    const view = {
      state: {
        selection: multiSel,
        doc: { nodesBetween },
        tr,
      },
      dispatch,
      focus,
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = clearFormattingInView(view);
    expect(result).toBe(true);
    // nodesBetween should be called for each non-empty range
    expect(nodesBetween).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalled();
  });
});

// ---------- clearFormattingInView ----------

describe("clearFormattingInView", () => {
  function createMockView(opts?: { empty?: boolean; hasMarks?: boolean }) {
    const empty = opts?.empty ?? false;
    const hasMarks = opts?.hasMarks ?? true;

    const marks = hasMarks
      ? [{ type: { name: "bold" } }, { type: { name: "italic" } }]
      : [];

    const dispatch = vi.fn();
    const focus = vi.fn();
    const removeMark = vi.fn().mockReturnThis();

    const tr = { removeMark, docChanged: hasMarks && !empty };

    const nodesBetween = vi.fn((_from: number, _to: number, cb: (node: Record<string, unknown>, pos: number) => void) => {
      if (!empty) {
        cb({ isText: true, marks, text: "hello", nodeSize: 5 }, 10);
      }
    });

    return {
      state: {
        selection: {
          $from: { pos: empty ? 10 : 5 },
          $to: { pos: empty ? 10 : 15 },
        },
        doc: { nodesBetween },
        tr,
      },
      dispatch,
      focus,
    } as unknown as import("@tiptap/pm/view").EditorView;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes marks from text nodes in selection", () => {
    const view = createMockView({ hasMarks: true });
    const result = clearFormattingInView(view);

    expect(result).toBe(true);
    expect(view.state.tr.removeMark).toHaveBeenCalledTimes(2);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it("returns false when selection is empty (collapsed)", () => {
    const view = createMockView({ empty: true });
    const result = clearFormattingInView(view);
    expect(result).toBe(false);
  });

  it("returns false when text has no marks", () => {
    const dispatch = vi.fn();
    const tr = { removeMark: vi.fn().mockReturnThis(), docChanged: false };

    const view = {
      state: {
        selection: {
          $from: { pos: 5 },
          $to: { pos: 15 },
        },
        doc: {
          nodesBetween: vi.fn((_from: number, _to: number, cb: (node: Record<string, unknown>, pos: number) => void) => {
            cb({ isText: true, marks: [], text: "hello", nodeSize: 5 }, 10);
          }),
        },
        tr,
      },
      dispatch,
      focus: vi.fn(),
    } as unknown as import("@tiptap/pm/view").EditorView;

    const result = clearFormattingInView(view);
    expect(result).toBe(false);
  });
});

// ---------- getCurrentHeadingLevel ----------

describe("getCurrentHeadingLevel", () => {
  it("returns heading level when cursor is in a heading", () => {
    const editor = {
      state: {
        selection: {
          $from: {
            parent: { type: { name: "heading" }, attrs: { level: 3 } },
          },
        },
      },
    } as unknown as TiptapEditor;

    expect(getCurrentHeadingLevel(editor)).toBe(3);
  });

  it("returns null when cursor is in a paragraph", () => {
    const editor = {
      state: {
        selection: {
          $from: {
            parent: { type: { name: "paragraph" }, attrs: {} },
          },
        },
      },
    } as unknown as TiptapEditor;

    expect(getCurrentHeadingLevel(editor)).toBeNull();
  });
});

// ---------- increaseHeadingLevel ----------

/**
 * Records WHICH level each command asks for, not merely that it asked.
 *
 * The previous mocks only checked `chain` was called, so four of these five
 * cases passed unchanged when the direction was inverted — the suite could not
 * tell H3→H2 from H3→H4. Capturing the argument is what makes the convention
 * testable at all.
 */
function createHeadingEditor(headingLevel: number | null) {
  const run = vi.fn();
  const setHeading = vi.fn(() => ({ run }));
  const setParagraph = vi.fn(() => ({ run }));
  const chain = vi.fn(() => ({ focus: vi.fn(() => ({ setHeading, setParagraph })) }));

  const parentType = headingLevel !== null ? "heading" : "paragraph";
  const attrs = headingLevel !== null ? { level: headingLevel } : {};

  return {
    editor: {
      state: { selection: { $from: { parent: { type: { name: parentType }, attrs } } } },
      chain,
    } as unknown as TiptapEditor,
    chain,
    setHeading,
    setParagraph,
    run,
  };
}

describe("increaseHeadingLevel", () => {
  it("turns a paragraph into H1 — the lowest level, not the smallest heading", () => {
    const { editor, setHeading } = createHeadingEditor(null);
    expect(increaseHeadingLevel(editor)).toBe(true);
    expect(setHeading).toHaveBeenCalledWith({ level: 1 });
  });

  it("increases the LEVEL NUMBER: H3 becomes H4", () => {
    const { editor, setHeading } = createHeadingEditor(3);
    expect(increaseHeadingLevel(editor)).toBe(true);
    expect(setHeading).toHaveBeenCalledWith({ level: 4 });
  });

  it("clamps at H6 rather than wrapping back to a paragraph", () => {
    const { editor, setHeading, setParagraph } = createHeadingEditor(6);
    expect(increaseHeadingLevel(editor)).toBe(false);
    expect(setHeading).not.toHaveBeenCalled();
    expect(setParagraph).not.toHaveBeenCalled();
  });
});

// ---------- decreaseHeadingLevel ----------

describe("decreaseHeadingLevel", () => {
  it("returns false when current node is not a heading", () => {
    const { editor } = createHeadingEditor(null);
    expect(decreaseHeadingLevel(editor)).toBe(false);
  });

  it("decreases the LEVEL NUMBER: H2 becomes H1", () => {
    const { editor, setHeading } = createHeadingEditor(2);
    expect(decreaseHeadingLevel(editor)).toBe(true);
    expect(setHeading).toHaveBeenCalledWith({ level: 1 });
  });

  it("converts H1 to a paragraph — the bottom of the sequence", () => {
    const { editor, setParagraph } = createHeadingEditor(1);
    expect(decreaseHeadingLevel(editor)).toBe(true);
    expect(setParagraph).toHaveBeenCalled();
  });

  it("is the exact inverse of increase, so the pair round-trips", () => {
    for (const level of [1, 2, 3, 4, 5]) {
      const up = createHeadingEditor(level);
      expect(increaseHeadingLevel(up.editor)).toBe(true);
      expect(up.setHeading).toHaveBeenCalledWith({ level: level + 1 });

      const down = createHeadingEditor(level + 1);
      expect(decreaseHeadingLevel(down.editor)).toBe(true);
      expect(down.setHeading).toHaveBeenCalledWith({ level });
    }
  });
});

// ---------- toggleBlockquote ----------

describe("toggleBlockquote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes blockquote when already active", () => {
    const editor = {
      isActive: vi.fn(() => true),
      view: { state: {}, dispatch: vi.fn(), focus: vi.fn() },
    } as unknown as TiptapEditor;

    expect(toggleBlockquote(editor)).toBe(true);
    expect(handleRemoveBlockquote).toHaveBeenCalled();
  });

  it("returns false when blockquote node type does not exist", () => {
    const editor = {
      isActive: vi.fn(() => false),
      view: {
        state: {
          selection: {
            $from: { depth: 1, node: vi.fn(() => ({ type: { name: "paragraph" } })), before: vi.fn(() => 0), blockRange: vi.fn(() => null) },
            $to: {},
          },
          schema: { nodes: {} },
          tr: { wrap: vi.fn().mockReturnThis() },
        },
        dispatch: vi.fn(),
        focus: vi.fn(),
      },
    } as unknown as TiptapEditor;

    expect(toggleBlockquote(editor)).toBe(false);
  });

  it("wraps selection in blockquote when not active", () => {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const blockRange = { depth: 1 };
    const wrap = vi.fn().mockReturnThis();

    const editor = {
      isActive: vi.fn(() => false),
      view: {
        state: {
          selection: {
            $from: {
              depth: 1,
              node: vi.fn(() => ({ type: { name: "paragraph" } })),
              before: vi.fn(() => 0),
              blockRange: vi.fn(() => blockRange),
            },
            $to: {},
          },
          schema: { nodes: { blockquote: { name: "blockquote" } } },
          tr: { wrap },
        },
        dispatch,
        focus,
      },
    } as unknown as TiptapEditor;

    expect(toggleBlockquote(editor)).toBe(true);
    expect(wrap).toHaveBeenCalledWith(blockRange, [{ type: { name: "blockquote" } }]);
    expect(dispatch).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it("wraps entire list when cursor is inside a list", () => {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const wrap = vi.fn().mockReturnThis();
    const blockRange = { depth: 1 };

    const editor = {
      isActive: vi.fn(() => false),
      view: {
        state: {
          selection: {
            $from: {
              depth: 2,
              node: vi.fn((d: number) => {
                if (d === 2) return { type: { name: "bulletList" } };
                return { type: { name: "doc" } };
              }),
              before: vi.fn(() => 0),
              after: vi.fn(() => 20),
              blockRange: vi.fn(() => blockRange),
            },
            $to: {},
          },
          schema: { nodes: { blockquote: { name: "blockquote" } } },
          tr: { wrap },
          doc: {
            resolve: vi.fn(() => ({
              blockRange: vi.fn(() => blockRange),
            })),
          },
        },
        dispatch,
        focus,
      },
    } as unknown as TiptapEditor;

    expect(toggleBlockquote(editor)).toBe(true);
  });

  it("returns false when tr.wrap throws", () => {
    const dispatch = vi.fn();
    const blockRange = { depth: 1 };

    const editor = {
      isActive: vi.fn(() => false),
      view: {
        state: {
          selection: {
            $from: {
              depth: 1,
              node: vi.fn(() => ({ type: { name: "paragraph" } })),
              before: vi.fn(() => 0),
              blockRange: vi.fn(() => blockRange),
            },
            $to: {},
          },
          schema: { nodes: { blockquote: { name: "blockquote" } } },
          tr: {
            wrap: vi.fn(() => {
              throw new Error("wrap failed");
            }),
          },
        },
        dispatch,
        focus: vi.fn(),
      },
    } as unknown as TiptapEditor;

    expect(toggleBlockquote(editor)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns false when range is null", () => {
    const editor = {
      isActive: vi.fn(() => false),
      view: {
        state: {
          selection: {
            $from: {
              depth: 1,
              node: vi.fn(() => ({ type: { name: "paragraph" } })),
              before: vi.fn(() => 0),
              blockRange: vi.fn(() => null),
            },
            $to: {},
          },
          schema: { nodes: { blockquote: { name: "blockquote" } } },
          tr: { wrap: vi.fn().mockReturnThis() },
        },
        dispatch: vi.fn(),
        focus: vi.fn(),
      },
    } as unknown as TiptapEditor;

    expect(toggleBlockquote(editor)).toBe(false);
  });
});

// ---------- handleWysiwygTransformCase ----------

describe("handleWysiwygTransformCase", () => {
  function createCaseContext(opts?: { empty?: boolean; selectedText?: string }): WysiwygToolbarContext {
    const empty = opts?.empty ?? false;
    const selectedText = opts?.selectedText ?? "Hello World";
    const dispatch = vi.fn();
    const focus = vi.fn();
    const setTextSelection = vi.fn();
    const insertText = vi.fn().mockReturnThis();

    return {
      surface: "wysiwyg",
      view: {
        state: {
          selection: { from: 5, to: empty ? 5 : 16, empty },
          doc: {
            nodesBetween: vi.fn((_from: number, _to: number, cb: (node: Record<string, unknown>, pos: number) => void) => {
              if (!empty) {
                cb({ isText: true, text: selectedText, nodeSize: selectedText.length }, 5);
              }
            }),
          },
          tr: { insertText },
        },
        dispatch,
      } as never,
      editor: {
        commands: { focus, setTextSelection },
      } as never,
      context: null,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const ctx = createCaseContext();
    ctx.view = null;
    expect(handleWysiwygTransformCase(ctx, "uppercase")).toBe(false);
  });

  it("returns false when editor is null", () => {
    const ctx = createCaseContext();
    ctx.editor = null;
    expect(handleWysiwygTransformCase(ctx, "uppercase")).toBe(false);
  });

  it("returns false when selection is empty", () => {
    const ctx = createCaseContext({ empty: true });
    expect(handleWysiwygTransformCase(ctx, "uppercase")).toBe(false);
  });

  it("transforms to uppercase", () => {
    const ctx = createCaseContext({ selectedText: "hello" });
    const result = handleWysiwygTransformCase(ctx, "uppercase");

    expect(result).toBe(true);
    expect(ctx.view!.dispatch).toHaveBeenCalled();
    expect(ctx.editor!.commands.focus).toHaveBeenCalled();
  });

  it("transforms to lowercase", () => {
    const ctx = createCaseContext({ selectedText: "HELLO" });
    const result = handleWysiwygTransformCase(ctx, "lowercase");
    expect(result).toBe(true);
  });

  it("transforms to titleCase", () => {
    const ctx = createCaseContext({ selectedText: "hello world" });
    const result = handleWysiwygTransformCase(ctx, "titleCase");
    expect(result).toBe(true);
  });

  it("transforms to toggleCase", () => {
    const ctx = createCaseContext({ selectedText: "Hello" });
    const result = handleWysiwygTransformCase(ctx, "toggleCase");
    expect(result).toBe(true);
  });

  it("returns true without dispatch when transformed text is same", () => {
    const ctx = createCaseContext({ selectedText: "HELLO" });
    const result = handleWysiwygTransformCase(ctx, "uppercase");
    expect(result).toBe(true);
    expect(ctx.view!.dispatch).not.toHaveBeenCalled();
  });

  it("returns false when no text extracted from nodes", () => {
    const ctx = createCaseContext();
    // Override nodesBetween to return no text nodes
    (ctx.view!.state.doc as { nodesBetween: ReturnType<typeof vi.fn> }).nodesBetween = vi.fn();
    expect(handleWysiwygTransformCase(ctx, "uppercase")).toBe(false);
  });
});

// ---------- toggleQuoteStyleAtCursor ----------

describe("toggleQuoteStyleAtCursor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createEditorForQuoteToggle(opts?: {
    isTextblock?: boolean;
    blockText?: string;
    parentOffset?: number;
    childText?: string;
  }) {
    const isTextblock = opts?.isTextblock ?? true;
    const childText = opts?.childText ?? opts?.blockText ?? '"hello"';
    const parentOffset = opts?.parentOffset ?? 1;

    const textChild = {
      isText: true,
      text: childText,
      nodeSize: childText.length,
    };

    const parent = {
      isTextblock: isTextblock,
      textContent: childText,
      childCount: 1,
      child: vi.fn(() => textChild),
      forEach: vi.fn((cb: (child: typeof textChild, offset: number) => void) => {
        cb(textChild, 0);
      }),
    };

    const dispatch = vi.fn();
    const focus = vi.fn();
    const insertText = vi.fn().mockReturnThis();

    return {
      state: {
        selection: {
          $from: {
            parent,
            parentOffset,
            start: vi.fn(() => 10),
          },
        },
        tr: {
          insertText,
          docChanged: true,
        },
      },
      view: { dispatch, focus },
    } as unknown as TiptapEditor;
  }

  it("returns false when parent is not a textblock", () => {
    const editor = createEditorForQuoteToggle({ isTextblock: false });
    expect(toggleQuoteStyleAtCursor(editor)).toBe(false);
  });

  it("returns false when block text is empty", () => {
    const editor = createEditorForQuoteToggle({ blockText: "" });
    // Override forEach to produce empty text
    const parent = editor.state.selection.$from.parent;
    (parent as { forEach: ReturnType<typeof vi.fn> }).forEach = vi.fn();
    (parent as { textContent: string }).textContent = "";

    expect(toggleQuoteStyleAtCursor(editor)).toBe(false);
  });

  it("returns false when computeQuoteToggle returns null", () => {
    vi.mocked(computeQuoteToggle).mockReturnValue(null);

    const editor = createEditorForQuoteToggle({ blockText: '"hello"' });
    expect(toggleQuoteStyleAtCursor(editor)).toBe(false);
  });

  it("applies quote replacements and dispatches transaction", () => {
    vi.mocked(computeQuoteToggle).mockReturnValue({
      replacements: [
        { offset: 0, oldChar: '"', newChar: '\u201C' },
        { offset: 6, oldChar: '"', newChar: '\u201D' },
      ],
    } as never);

    const editor = createEditorForQuoteToggle({ blockText: '"hello"' });
    const result = toggleQuoteStyleAtCursor(editor);

    expect(result).toBe(true);
    expect(editor.state.tr.insertText).toHaveBeenCalledTimes(2);
    expect(editor.view.dispatch).toHaveBeenCalled();
    expect(editor.view.focus).toHaveBeenCalled();
  });

  it("handles non-text children (inline atoms) when computing cursor offset", () => {
    // Simulate: textChild("ab") + atomChild(hardBreak, nodeSize=1) + textChild('"cd"')
    // parentOffset = 4 means cursor is after the atom, inside the second text child
    const textChild1 = { isText: true, text: "ab", nodeSize: 2 };
    const atomChild = { isText: false, text: undefined, nodeSize: 1 };
    const textChild2 = { isText: true, text: '"cd"', nodeSize: 4 };
    const children = [textChild1, atomChild, textChild2];

    const parent = {
      isTextblock: true,
      childCount: 3,
      child: vi.fn((i: number) => children[i]),
      forEach: vi.fn((cb: (child: typeof textChild1, offset: number) => void) => {
        cb(textChild1, 0);
        // atomChild is not text, so forEach skips it for text building
        cb(textChild2, 3); // offset after textChild1(2) + atomChild(1)
      }),
    };

    vi.mocked(computeQuoteToggle).mockReturnValue({
      replacements: [
        { offset: 2, oldChar: '"', newChar: '\u201C' },
      ],
    } as never);

    const insertText = vi.fn().mockReturnThis();
    const editor = {
      state: {
        selection: {
          $from: {
            parent,
            parentOffset: 4, // inside atomChild's range → after textChild1 + into atomChild
            start: vi.fn(() => 10),
          },
        },
        tr: { insertText, docChanged: true },
      },
      view: { dispatch: vi.fn(), focus: vi.fn() },
    } as unknown as TiptapEditor;

    const result = toggleQuoteStyleAtCursor(editor);
    expect(result).toBe(true);
    expect(insertText).toHaveBeenCalled();
  });

  it("returns false when transaction has no changes", () => {
    vi.mocked(computeQuoteToggle).mockReturnValue({
      replacements: [],
    } as never);

    const editor = createEditorForQuoteToggle({ blockText: '"hello"' });
    (editor.state.tr as { docChanged: boolean }).docChanged = false;

    const result = toggleQuoteStyleAtCursor(editor);
    expect(result).toBe(false);
  });
});
