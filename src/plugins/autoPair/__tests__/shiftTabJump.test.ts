// @vitest-environment node
/**
 * Shift+Tab Jump — Bracket Pair Left-Skip Tests
 *
 * When cursor is right after an opening bracket/quote, Shift+Tab moves
 * cursor one position backward (before the opening char).
 * Mirrors handleTabJump (right-skip over closing char).
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import {
  handleShiftTabJump,
  type AutoPairConfig,
} from "../handlers";

/* ------------------------------------------------------------------ */
/*  Schema & helpers                                                   */
/* ------------------------------------------------------------------ */

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

function createState(text: string, cursorOffset?: number): EditorState {
  const textNode = text ? schema.text(text) : undefined;
  const para = schema.node("paragraph", null, textNode ? [textNode] : []);
  const doc = schema.node("doc", null, [para]);
  const state = EditorState.create({ doc, schema });

  if (cursorOffset !== undefined) {
    const pos = 1 + cursorOffset;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos)),
    );
  }
  return state;
}

function createMockView(state: EditorState) {
  const view = {
    state,
    dispatch: vi.fn((tr: ReturnType<EditorState["tr"]["setSelection"]>) => {
      view.state = view.state.apply(tr);
    }),
  } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };
  return view;
}

function getCursorOffset(state: EditorState): number {
  return state.selection.from - 1;
}

const ENABLED: AutoPairConfig = {
  enabled: true,
  includeCJK: true,
  includeCurlyQuotes: true,
  normalizeRightDoubleQuote: false,
};

const DISABLED: AutoPairConfig = {
  enabled: false,
  includeCJK: false,
  includeCurlyQuotes: false,
  normalizeRightDoubleQuote: false,
};

const CJK_OFF: AutoPairConfig = {
  enabled: true,
  includeCJK: false,
  includeCurlyQuotes: false,
  normalizeRightDoubleQuote: false,
};

/* ------------------------------------------------------------------ */
/*  ASCII pairs                                                        */
/* ------------------------------------------------------------------ */

describe("handleShiftTabJump — ASCII pairs", () => {
  it("jumps before opening parenthesis", () => {
    const state = createState("(text)", 1); // cursor after (
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before opening square bracket", () => {
    const state = createState("[text]", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before opening curly brace", () => {
    const state = createState("{text}", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before opening double quote", () => {
    const state = createState('"text"', 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before opening single quote", () => {
    const state = createState("'text'", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before opening backtick", () => {
    const state = createState("`text`", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  CJK pairs                                                         */
/* ------------------------------------------------------------------ */

describe("handleShiftTabJump — CJK pairs", () => {
  it("jumps before CJK fullwidth parenthesis when enabled", () => {
    const state = createState("（text）", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before CJK lenticular bracket when enabled", () => {
    const state = createState("【text】", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before CJK corner bracket when enabled", () => {
    const state = createState("「text」", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("does not jump CJK brackets when CJK disabled", () => {
    const state = createState("（text）", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, CJK_OFF)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Curly quotes                                                       */
/* ------------------------------------------------------------------ */

describe("handleShiftTabJump — curly quotes", () => {
  it("jumps before left double curly quote when enabled", () => {
    const state = createState("\u201Ctext\u201D", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("jumps before left single curly quote when enabled", () => {
    const state = createState("\u2018text\u2019", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("does not jump curly quotes when curly quotes disabled", () => {
    const state = createState("\u201Ctext\u201D", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, CJK_OFF)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Guards                                                             */
/* ------------------------------------------------------------------ */

describe("handleShiftTabJump — guards", () => {
  it("returns false when disabled", () => {
    const state = createState("(text)", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, DISABLED)).toBe(false);
  });

  it("returns false when char before cursor is not an opening char", () => {
    const state = createState("hello", 3);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(false);
  });

  it("returns false when there is a selection", () => {
    const state = createState("(text)", 0);
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 3)),
    );
    const view = createMockView(withSel);

    expect(handleShiftTabJump(view, ENABLED)).toBe(false);
  });

  it("returns false at start of document (pos <= 1)", () => {
    const state = createState("(text)", 0); // cursor at paragraph start
    const view = createMockView(state);

    // pos = 1, getCharBefore returns "" since parentOffset = 0
    expect(handleShiftTabJump(view, ENABLED)).toBe(false);
  });

  it("does not add to history", () => {
    const state = createState("(text)", 1);
    const view = createMockView(state);

    handleShiftTabJump(view, ENABLED);

    const tr = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(tr.getMeta("addToHistory")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases                                                         */
/* ------------------------------------------------------------------ */

describe("handleShiftTabJump — edge cases", () => {
  it("skips only innermost opening bracket in nested brackets", () => {
    // ({[|text]}) — cursor after [, should skip [ only
    const state = createState("({[text]})", 3);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2); // moved before [
  });

  it("handles opening bracket at start of paragraph", () => {
    // (|text) — cursor after ( at pos 2, ( is at pos 1
    const state = createState("(text)", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });
});
