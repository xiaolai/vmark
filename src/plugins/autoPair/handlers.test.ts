/**
 * Auto-Pair Handler Tests
 *
 * Tests for handleTextInput, handleClosingBracket, handleBackspacePair, and
 * createKeyHandler — exercised at the ProseMirror state/transaction level.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
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
