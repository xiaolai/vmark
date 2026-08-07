// @vitest-environment node
/**
 * Auto-Pair Handler Tests
 *
 * Tests for handleTextInput, handleClosingBracket, handleBackspacePair, and
 * createKeyHandler — exercised at the ProseMirror state/transaction level.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import {
  handleTextInput,
  handleClosingBracket,
  handleBackspacePair,
  type AutoPairConfig,
} from "./handlers";

/* ------------------------------------------------------------------ */
/*  Minimal schema & helpers                                           */
/* ------------------------------------------------------------------ */

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

/** Create an EditorState with a single paragraph containing `text`.
 *  Cursor is placed at `cursorOffset` within the text (0 = before first char). */
function createState(text: string, cursorOffset?: number): EditorState {
  const textNode = text ? schema.text(text) : undefined;
  const para = schema.node("paragraph", null, textNode ? [textNode] : []);
  const doc = schema.node("doc", null, [para]);
  const state = EditorState.create({ doc, schema });

  if (cursorOffset !== undefined) {
    // Position 1 = start of paragraph content
    const pos = 1 + cursorOffset;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos)),
    );
  }
  return state;
}

/** Create a minimal mock EditorView that captures dispatched transactions. */
function createMockView(state: EditorState) {
  const dispatched: ReturnType<EditorState["tr"]["setSelection"]>[] = [];
  const view = {
    state,
    dispatch: vi.fn((tr: ReturnType<EditorState["tr"]["setSelection"]>) => {
      dispatched.push(tr);
      // Update the view's state after dispatch (matches real ProseMirror)
      view.state = view.state.apply(tr);
    }),
  } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };
  return { view, dispatched };
}

/* ------------------------------------------------------------------ */
/*  Configs                                                            */
/* ------------------------------------------------------------------ */

const CURLY_ON: AutoPairConfig = {
  enabled: true,
  includeCJK: true,
  includeCurlyQuotes: true,
  normalizeRightDoubleQuote: false,
};

const CURLY_OFF: AutoPairConfig = {
  enabled: true,
  includeCJK: true,
  includeCurlyQuotes: false,
  normalizeRightDoubleQuote: false,
};

const ALL_OFF: AutoPairConfig = {
  enabled: true,
  includeCJK: false,
  includeCurlyQuotes: false,
  normalizeRightDoubleQuote: false,
};

const DISABLED: AutoPairConfig = {
  enabled: false,
  includeCJK: false,
  includeCurlyQuotes: false,
  normalizeRightDoubleQuote: false,
};

/* ------------------------------------------------------------------ */
/*  Helper to get paragraph text from state                            */
/* ------------------------------------------------------------------ */

function getText(state: EditorState): string {
  return state.doc.firstChild!.textContent;
}

function getCursorOffset(state: EditorState): number {
  return state.selection.from - 1; // subtract paragraph start
}

/* ================================================================== */
/*  handleTextInput                                                    */
/* ================================================================== */

describe("handleTextInput", () => {
  describe("basic auto-pairing", () => {
    it("pairs parentheses", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);
      const handled = handleTextInput(view, 1, 1, "(", CURLY_ON);
      expect(handled).toBe(true);
      expect(getText(view.state)).toBe("()");
      expect(getCursorOffset(view.state)).toBe(1); // between ( and )
    });

    it("pairs square brackets", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);
      handleTextInput(view, 1, 1, "[", CURLY_ON);
      expect(getText(view.state)).toBe("[]");
      expect(getCursorOffset(view.state)).toBe(1);
    });

    it("pairs straight double quotes", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);
      handleTextInput(view, 1, 1, '"', ALL_OFF);
      expect(getText(view.state)).toBe('""');
      expect(getCursorOffset(view.state)).toBe(1);
    });
  });

  describe("curly quote conversion (issue #57)", () => {
    it("converts straight \" to curly pair when curly quotes enabled", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);

      const handled = handleTextInput(view, 1, 1, '"', CURLY_ON);

      expect(handled).toBe(true);
      // Should produce curly pair \u201C\u201D, not straight ""
      expect(getText(view.state)).toBe("\u201C\u201D");
      expect(getCursorOffset(view.state)).toBe(1);
    });

    it("converts straight ' to curly pair when curly quotes enabled", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);

      const handled = handleTextInput(view, 1, 1, "'", CURLY_ON);

      expect(handled).toBe(true);
      // Should produce curly single pair \u2018\u2019
      expect(getText(view.state)).toBe("\u2018\u2019");
      expect(getCursorOffset(view.state)).toBe(1);
    });

    it("keeps straight \" when curly quotes disabled", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);

      handleTextInput(view, 1, 1, '"', CURLY_OFF);

      expect(getText(view.state)).toBe('""');
    });

    it("typing inside curly pair inserts character correctly (main bug)", () => {
      // Simulate: type " → get \u201C|\u201D → type t → should get \u201Ct|\u201D
      const state = createState("", 0);
      const { view } = createMockView(state);

      // Step 1: type " → auto-pair to curly quotes
      handleTextInput(view, 1, 1, '"', CURLY_ON);
      expect(getText(view.state)).toBe("\u201C\u201D");
      expect(getCursorOffset(view.state)).toBe(1);

      // Step 2: type t (not handled by auto-pair, but cursor should be correct)
      const cursorPos = view.state.selection.from; // should be 2
      const handled = handleTextInput(view, cursorPos, cursorPos, "t", CURLY_ON);
      // 't' is not a pair character, should not be handled
      expect(handled).toBe(false);
      // State should be unchanged (ProseMirror default would insert t)
      expect(getText(view.state)).toBe("\u201C\u201D");
    });

    it("handles curly opening quote \u201C directly (from macOS Smart Quotes)", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);

      const handled = handleTextInput(view, 1, 1, "\u201C", CURLY_ON);

      expect(handled).toBe(true);
      expect(getText(view.state)).toBe("\u201C\u201D");
      expect(getCursorOffset(view.state)).toBe(1);
    });

    it("does not double-pair: skip if next char is already the closing curly quote", () => {
      // State: \u201C|\u201D (cursor between curly pair)
      const state = createState("\u201C\u201D", 1);
      const { view } = createMockView(state);

      // Typing \u201C again should be skipped (next char is \u201D = closing)
      const handled = handleTextInput(view, 2, 2, "\u201C", CURLY_ON);
      expect(handled).toBe(false);
    });

    it("does not double-pair: skip if next char is closing for straight-to-curly conversion", () => {
      // State: \u201C|\u201D (cursor between curly pair)
      const state = createState("\u201C\u201D", 1);
      const { view } = createMockView(state);

      // Typing straight " should be converted to \u201C,
      // and since next char is \u201D (its closing), should skip
      const handled = handleTextInput(view, 2, 2, '"', CURLY_ON);
      expect(handled).toBe(false);
    });
  });

  describe("wrapping selection", () => {
    it("wraps selected text with curly quotes when curly enabled", () => {
      // Select "hello" and type "
      const state = createState("hello", 0);
      const withSel = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
      );
      const { view } = createMockView(withSel);

      handleTextInput(view, 1, 6, '"', CURLY_ON);

      expect(getText(view.state)).toBe("\u201Chello\u201D");
    });
  });

  describe("wrapping selection preserves content (PL-3)", () => {
    // Richer schema: a mark and an inline atom, like the real editor schema
    // (bold marks, inline math, footnote refs, hard breaks).
    const richSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "inline*", group: "block" },
        text: { inline: true, group: "inline" },
        atom: { inline: true, group: "inline", atom: true },
      },
      marks: { bold: {} },
    });

    function selectAndWrap(doc: ReturnType<typeof richSchema.node>, from: number, to: number) {
      let state = EditorState.create({ doc });
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, from, to)),
      );
      const { view } = createMockView(state);
      const handled = handleTextInput(view, from, to, "(", CURLY_ON);
      return { handled, view };
    }

    it("keeps marks on wrapped content", () => {
      const bold = richSchema.marks.bold.create();
      const doc = richSchema.node("doc", null, [
        richSchema.node("paragraph", null, [
          richSchema.text("he"),
          richSchema.text("ll", [bold]),
          richSchema.text("o"),
        ]),
      ]);

      const { handled, view } = selectAndWrap(doc, 1, 6);

      expect(handled).toBe(true);
      expect(view.state.doc.firstChild!.textContent).toBe("(hello)");
      // Bold mark survives (originally on "ll" at 3..5, shifted to 4..6)
      const boldRanges: Array<[number, number]> = [];
      view.state.doc.descendants((node, pos) => {
        if (node.isText && richSchema.marks.bold.isInSet(node.marks)) {
          boldRanges.push([pos, pos + node.nodeSize]);
        }
      });
      expect(boldRanges).toEqual([[4, 6]]);
      // Cursor sits after the wrapped content, before the closing char
      expect(view.state.selection.from).toBe(7);
    });

    it("keeps inline atoms inside the wrapped selection", () => {
      const doc = richSchema.node("doc", null, [
        richSchema.node("paragraph", null, [
          richSchema.text("a"),
          richSchema.node("atom"),
          richSchema.text("b"),
        ]),
      ]);

      // Selection spans "a", the atom, and "b" (positions 1..4)
      const { handled, view } = selectAndWrap(doc, 1, 4);

      expect(handled).toBe(true);
      let atomCount = 0;
      view.state.doc.descendants((node) => {
        if (node.type.name === "atom") atomCount++;
      });
      expect(atomCount).toBe(1);
      expect(view.state.doc.firstChild!.textContent).toBe("(ab)");
      expect(view.state.selection.from).toBe(5);
    });

    it("wraps a cross-paragraph selection without destroying structure", () => {
      const doc = richSchema.node("doc", null, [
        richSchema.node("paragraph", null, [richSchema.text("ab")]),
        richSchema.node("paragraph", null, [richSchema.text("cd")]),
      ]);

      // From before "b" (pos 2) to before "d" (pos 6)
      const { handled, view } = selectAndWrap(doc, 2, 6);

      expect(handled).toBe(true);
      // Both paragraphs survive: opening char at the selection start,
      // closing char at the selection end.
      expect(view.state.doc.childCount).toBe(2);
      expect(view.state.doc.child(0).textContent).toBe("a(b");
      expect(view.state.doc.child(1).textContent).toBe("c)d");
    });
  });

  describe("non-textblock selection endpoints (Codex audit finding 3)", () => {
    it("AllSelection (Cmd+A) falls through: no wrap, no stray paragraphs", () => {
      const state = createState("hello");
      const allSel = new AllSelection(state.doc);
      const selState = state.apply(state.tr.setSelection(allSel));
      const { view } = createMockView(selState);

      const handled = handleTextInput(view, allSel.from, allSel.to, "(", CURLY_ON);

      expect(handled).toBe(false);
      expect(view.dispatch).not.toHaveBeenCalled();
      expect(view.state.doc.childCount).toBe(1);
      expect(getText(view.state)).toBe("hello");
    });

    it("NodeSelection on a top-level block falls through", () => {
      const state = createState("hello");
      const nodeSel = NodeSelection.create(state.doc, 0);
      const selState = state.apply(state.tr.setSelection(nodeSel));
      const { view } = createMockView(selState);

      const handled = handleTextInput(view, nodeSel.from, nodeSel.to, "[", CURLY_ON);

      expect(handled).toBe(false);
      expect(view.dispatch).not.toHaveBeenCalled();
      expect(view.state.doc.childCount).toBe(1);
      expect(getText(view.state)).toBe("hello");
    });

    it("normal text selection wrap is unchanged", () => {
      const state = createState("hello");
      const selState = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
      );
      const { view } = createMockView(selState);

      const handled = handleTextInput(view, 1, 6, "(", CURLY_ON);

      expect(handled).toBe(true);
      expect(getText(view.state)).toBe("(hello)");
    });
  });

  describe("disabled states", () => {
    it("returns false when disabled", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);
      expect(handleTextInput(view, 1, 1, '"', DISABLED)).toBe(false);
    });

    it("returns false for multi-char input", () => {
      const state = createState("", 0);
      const { view } = createMockView(state);
      expect(handleTextInput(view, 1, 1, '""', CURLY_ON)).toBe(false);
    });
  });
});

/* ================================================================== */
/*  handleClosingBracket                                               */
/* ================================================================== */

describe("handleClosingBracket", () => {
  it("skips over closing parenthesis", () => {
    const state = createState("()", 1); // cursor between ( and )
    const { view } = createMockView(state);

    const handled = handleClosingBracket(view, ")", CURLY_ON);

    expect(handled).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2); // after )
  });

  it("skips over curly closing quote \u201D", () => {
    const state = createState("\u201C\u201D", 1); // cursor between curly pair
    const { view } = createMockView(state);

    const handled = handleClosingBracket(view, "\u201D", CURLY_ON);

    expect(handled).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2);
  });

  it("does NOT skip when next char doesn't match", () => {
    const state = createState("(x", 1); // cursor between ( and x
    const { view } = createMockView(state);

    const handled = handleClosingBracket(view, ")", CURLY_ON);

    expect(handled).toBe(false);
  });

  it("does NOT skip when disabled", () => {
    const state = createState("()", 1);
    const { view } = createMockView(state);

    expect(handleClosingBracket(view, ")", DISABLED)).toBe(false);
  });
});

/* ================================================================== */
/*  handleBackspacePair                                                */
/* ================================================================== */

describe("handleTextInput — normalizeRightDoubleQuote branch", () => {
  it("normalizes right double curly quote to left when normalizeRightDoubleQuote is true", () => {
    // \u201D is the right/closing curly quote; with normalization it becomes \u201C (opening)
    // and auto-pair should insert \u201C\u201D pair.
    // Requires includeCJK: true so getClosingChar recognises \u201C.
    const config: AutoPairConfig = {
      enabled: true,
      includeCJK: true,
      includeCurlyQuotes: true,
      normalizeRightDoubleQuote: true,
    };
    const state = createState("", 0);
    const { view } = createMockView(state);
    const handled = handleTextInput(view, 1, 1, "\u201D", config);
    expect(handled).toBe(true);
    // \u201D is normalized to \u201C, which pairs with \u201D
    expect(getText(view.state)).toBe("\u201C\u201D");
  });
});

describe("handleBackspacePair", () => {
  it("deletes curly quote pair when cursor is between them", () => {
    const state = createState("\u201C\u201D", 1);
    const { view } = createMockView(state);

    const handled = handleBackspacePair(view, CURLY_ON);

    expect(handled).toBe(true);
    expect(getText(view.state)).toBe("");
  });

  it("deletes parenthesis pair", () => {
    const state = createState("()", 1);
    const { view } = createMockView(state);

    const handled = handleBackspacePair(view, CURLY_ON);

    expect(handled).toBe(true);
    expect(getText(view.state)).toBe("");
  });

  it("does NOT delete when chars don't form a pair", () => {
    const state = createState("(x", 1);
    const { view } = createMockView(state);

    expect(handleBackspacePair(view, CURLY_ON)).toBe(false);
  });
});
