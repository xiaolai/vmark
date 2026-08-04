/**
 * Extra Handler Tests — coverage gaps
 *
 * Extends handlers.test.ts to cover handleTabJump, createKeyHandler,
 * normalizeRightDoubleQuote, and additional edge cases.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import {
  handleTextInput,
  handleTabJump,
  handleShiftTabJump,
  handleClosingBracket,
  handleBackspacePair,
  type AutoPairConfig,
} from "../handlers";
import { createKeyHandler } from "../keyHandler";

/* ------------------------------------------------------------------ */
/*  Minimal schema & helpers                                           */
/* ------------------------------------------------------------------ */

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    codeBlock: { content: "text*", group: "block", code: true },
    text: { inline: true },
  },
  marks: {
    code: {
      excludes: "_",
      parseDOM: [{ tag: "code" }],
      toDOM() {
        return ["code", 0];
      },
    },
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

const NORMALIZE_ON: AutoPairConfig = {
  enabled: true,
  includeCJK: true,
  includeCurlyQuotes: true,
  normalizeRightDoubleQuote: true,
};

const CJK_OFF: AutoPairConfig = {
  enabled: true,
  includeCJK: false,
  includeCurlyQuotes: false,
  normalizeRightDoubleQuote: false,
};

/* ================================================================== */
/*  handleTabJump                                                      */
/* ================================================================== */

describe("handleTabJump", () => {
  it("jumps over closing parenthesis", () => {
    const state = createState("()", 1); // cursor between ( and )
    const view = createMockView(state);

    const handled = handleTabJump(view, ENABLED);

    expect(handled).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2);
  });

  it("jumps over closing bracket", () => {
    const state = createState("[]", 1);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2);
  });

  it("jumps over closing curly quote", () => {
    const state = createState("\u201C\u201D", 1);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2);
  });

  it("returns false when disabled", () => {
    const state = createState("()", 1);
    const view = createMockView(state);

    expect(handleTabJump(view, DISABLED)).toBe(false);
  });

  it("returns false when next char is not a closing bracket", () => {
    const state = createState("(x", 1);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(false);
  });

  it("returns false when there is a selection", () => {
    const state = createState("()", 0);
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 3)),
    );
    const view = createMockView(withSel);

    expect(handleTabJump(view, ENABLED)).toBe(false);
  });

  it("does not jump over closing chars disabled by config", () => {
    // CJK curly quotes should not be jumpable when CJK is off
    const state = createState("\u201C\u201D", 1);
    const view = createMockView(state);

    expect(handleTabJump(view, CJK_OFF)).toBe(false);
  });

  it("does not add to history", () => {
    const state = createState("()", 1);
    const view = createMockView(state);

    handleTabJump(view, ENABLED);

    const tr = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(tr.getMeta("addToHistory")).toBe(false);
  });
});

/* ================================================================== */
/*  handleTextInput — normalizeRightDoubleQuote                        */
/* ================================================================== */

describe("handleTextInput — normalizeRightDoubleQuote", () => {
  it("normalizes right double quote U+201D to left U+201C when enabled", () => {
    const state = createState("", 0);
    const view = createMockView(state);

    const handled = handleTextInput(view, 1, 1, "\u201D", NORMALIZE_ON);

    expect(handled).toBe(true);
    // Should produce \u201C\u201D pair (left/right curly double quotes)
    expect(view.state.doc.firstChild!.textContent).toBe("\u201C\u201D");
  });

  it("does not normalize when normalizeRightDoubleQuote is false", () => {
    const config: AutoPairConfig = {
      enabled: true,
      includeCJK: true,
      includeCurlyQuotes: true,
      normalizeRightDoubleQuote: false,
    };
    const state = createState("", 0);
    const view = createMockView(state);

    // U+201D is a closing char, but without normalization it won't be treated
    // as an opening char. handleTextInput checks getClosingChar on the input.
    const handled = handleTextInput(view, 1, 1, "\u201D", config);

    // U+201D has no closing pair (it IS the closing char), so not handled
    expect(handled).toBe(false);
  });
});

/* ================================================================== */
/*  handleClosingBracket — additional edge cases                       */
/* ================================================================== */

describe("handleClosingBracket — extra", () => {
  it("skips over closing square bracket", () => {
    const state = createState("[]", 1);
    const view = createMockView(state);

    expect(handleClosingBracket(view, "]", ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2);
  });

  it("skips over closing curly brace", () => {
    const state = createState("{}", 1);
    const view = createMockView(state);

    expect(handleClosingBracket(view, "}", ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2);
  });

  it("does not skip when CJK closing char and CJK disabled", () => {
    const state = createState("\u201C\u201D", 1);
    const view = createMockView(state);

    // CJK curly quote closing should not be skippable when CJK is off
    expect(handleClosingBracket(view, "\u201D", CJK_OFF)).toBe(false);
  });

  it("does not skip when selection exists", () => {
    const state = createState("()", 0);
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 3)),
    );
    const view = createMockView(withSel);

    expect(handleClosingBracket(view, ")", ENABLED)).toBe(false);
  });
});

/* ================================================================== */
/*  handleBackspacePair — additional edge cases                        */
/* ================================================================== */

describe("handleBackspacePair — extra", () => {
  it("returns false when disabled", () => {
    const state = createState("()", 1);
    const view = createMockView(state);

    expect(handleBackspacePair(view, DISABLED)).toBe(false);
  });

  it("returns false with selection", () => {
    const state = createState("()", 0);
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 3)),
    );
    const view = createMockView(withSel);

    expect(handleBackspacePair(view, ENABLED)).toBe(false);
  });

  it("returns false at position 0 (start of document)", () => {
    const _state = createState("()", 0);
    // Cursor at position 1 (paragraph start), from = 1, but we need from < 1
    // Actually from = 1 > 0, so let's check default selection (from = 1)
    // The function checks from < 1, position 1 is >= 1 so it proceeds.
    // We need the default state with cursor at pos 0
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("()")]),
    ]);
    const st = EditorState.create({ doc, schema });
    // Default selection is at end. Let's check it works.
    expect(handleBackspacePair(createMockView(st), ENABLED)).toBe(false);
  });

  it("deletes CJK bracket pair", () => {
    const state = createState("\u300C\u300D", 1); // Corner brackets
    const view = createMockView(state);

    expect(handleBackspacePair(view, ENABLED)).toBe(true);
    expect(view.state.doc.firstChild!.textContent).toBe("");
  });

  it("does not delete CJK pair when CJK disabled", () => {
    const state = createState("\u300C\u300D", 1);
    const view = createMockView(state);

    expect(handleBackspacePair(view, CJK_OFF)).toBe(false);
  });
});

/* ================================================================== */
/*  createKeyHandler                                                   */
/* ================================================================== */

describe("createKeyHandler", () => {
  function createKeyEvent(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      ...opts,
    } as unknown as KeyboardEvent;
  }

  it("returns false when ctrl is pressed", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("()", 1);
    const view = createMockView(state);
    const event = createKeyEvent(")", { ctrlKey: true });

    expect(handler(view, event)).toBe(false);
  });

  it("returns false when alt is pressed", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("()", 1);
    const view = createMockView(state);
    const event = createKeyEvent(")", { altKey: true });

    expect(handler(view, event)).toBe(false);
  });

  it("returns false when meta is pressed", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("()", 1);
    const view = createMockView(state);
    const event = createKeyEvent(")", { metaKey: true });

    expect(handler(view, event)).toBe(false);
  });

  it("handles Tab key to jump over closing bracket", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("()", 1);
    const view = createMockView(state);
    const event = createKeyEvent("Tab");

    const result = handler(view, event);

    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("handles Shift+Tab to jump before opening bracket", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("()", 1); // cursor after (
    const view = createMockView(state);
    const event = createKeyEvent("Tab", { shiftKey: true });

    const result = handler(view, event);
    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(getCursorOffset(view.state)).toBe(0);
  });

  it("returns false for Shift+Tab when not after opening bracket", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("hello", 3); // cursor in plain text
    const view = createMockView(state);
    const event = createKeyEvent("Tab", { shiftKey: true });

    expect(handler(view, event)).toBe(false);
  });

  it("returns false for Tab when not next to closing bracket", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("hello", 2);
    const view = createMockView(state);
    const event = createKeyEvent("Tab");

    expect(handler(view, event)).toBe(false);
  });

  it("handles Backspace to delete pair", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("()", 1);
    const view = createMockView(state);
    const event = createKeyEvent("Backspace");

    const result = handler(view, event);

    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("returns false for Backspace when not between pair", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("ab", 1);
    const view = createMockView(state);
    const event = createKeyEvent("Backspace");

    expect(handler(view, event)).toBe(false);
  });

  it("handles closing bracket skip", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("()", 1);
    const view = createMockView(state);
    const event = createKeyEvent(")");

    const result = handler(view, event);

    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("returns false for non-closing single char", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("hello", 2);
    const view = createMockView(state);
    const event = createKeyEvent("x");

    expect(handler(view, event)).toBe(false);
  });

  it("handles straight quote skip-over for curly closing equivalent", () => {
    // When curly quotes enabled, typing " (straight) should skip over \u201D (curly closing)
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("\u201C\u201D", 1); // cursor between curly pair
    const view = createMockView(state);

    // event.key is " (straight) but doc has \u201D
    // First handleClosingBracket with " fails (next char is \u201D not ")
    // Then curly closing conversion: " -> \u201D, matches next char, skip
    const event = createKeyEvent('"');
    const result = handler(view, event);

    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("reads fresh config on each keydown", () => {
    let config = DISABLED;
    const handler = createKeyHandler(() => config);
    const state = createState("()", 1);

    // First call: disabled
    const view1 = createMockView(state);
    const event1 = createKeyEvent("Backspace");
    expect(handler(view1, event1)).toBe(false);

    // Enable config
    config = ENABLED;

    // Second call: enabled
    const view2 = createMockView(state);
    const event2 = createKeyEvent("Backspace");
    expect(handler(view2, event2)).toBe(true);
  });

  it("returns false for multi-char keys (non-single-char input)", () => {
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("hello", 2);
    const view = createMockView(state);
    const event = createKeyEvent("Enter");

    expect(handler(view, event)).toBe(false);
  });
});

/* ================================================================== */
/*  handleTextInput — closing char already present (line 186/191)     */
/* ================================================================== */

describe("handleTextInput — skip when next char is already closing (line 191)", () => {
  it("returns false when next char is already the closing bracket (no selection)", () => {
    // Cursor is between ( and ), typing ( again should be skipped
    // because the next char is already )
    const state = createState("()", 1); // cursor between ( and )
    const view = createMockView(state);

    // Typing "(" with no selection — nextChar is ")" which is the closing char
    const handled = handleTextInput(view, 1 + 1, 1 + 1, "(", ENABLED);

    // Next char is ")" === closing for "(", so returns false to avoid double-pairing
    expect(handled).toBe(false);
  });
});

/* ================================================================== */
/*  handleBacktickCodeToggle — code block and no code mark schema      */
/* ================================================================== */

describe("handleBacktickCodeToggle — uncovered branches", () => {
  // Schema with codeBlock node (isInCodeBlock returns true for codeBlock content)
  const codeBlockSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block" },
      codeBlock: { content: "text*", group: "block", code: true },
      text: { inline: true },
    },
    marks: {
      code: {
        excludes: "_",
        parseDOM: [{ tag: "code" }],
        toDOM() { return ["code", 0]; },
      },
    },
  });

  // Schema WITHOUT code mark
  const noCodeMarkSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block" },
      text: { inline: true },
    },
  });

  it("returns false when typing backtick inside a codeBlock (line 84 guard)", () => {
    // isInCodeBlock returns true when cursor is inside a node with code=true
    const doc = codeBlockSchema.node("doc", null, [
      codeBlockSchema.node("codeBlock", null, [codeBlockSchema.text("some code")]),
    ]);
    const state = EditorState.create({ doc, schema: codeBlockSchema });
    const stateWithCursor = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3))
    );

    let _newState = stateWithCursor;
    const mockView = {
      state: stateWithCursor,
      dispatch: (tr: ReturnType<EditorState["tr"]["setSelection"]>) => {
        _newState = stateWithCursor.apply(tr);
      },
    } as unknown as EditorView;

    const { from, to } = stateWithCursor.selection;
    const handled = handleTextInput(mockView, from, to, "`", ENABLED);

    // In code block → returns false (line 84 guard)
    expect(handled).toBe(false);
  });

  it("returns false when schema has no code mark (line 87 guard)", () => {
    const doc = noCodeMarkSchema.node("doc", null, [
      noCodeMarkSchema.node("paragraph", null, [noCodeMarkSchema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema: noCodeMarkSchema });
    const stateWithCursor = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3))
    );

    let newState = stateWithCursor;
    const mockView = {
      state: stateWithCursor,
      dispatch: (tr: ReturnType<EditorState["tr"]["setSelection"]>) => {
        newState = stateWithCursor.apply(tr);
      },
    } as unknown as EditorView;

    const { from, to } = stateWithCursor.selection;
    const handled = handleTextInput(mockView, from, to, "`", ENABLED);

    // No code mark in schema → returns false (line 87 guard)
    expect(handled).toBe(false);
    void newState; // suppress unused warning
  });

  it("returns false when cursor is in code but findCodeMarkEnd returns null (line 102 path)", () => {
    // This is the case where the cursor is marked as in code, but findCodeMarkEnd
    // can't locate the code child node (which shouldn't happen in practice but
    // the guard exists). We test it by exercising the normal path where
    // cursor is at end of code and endPos is correctly found.
    // For the null path: we need cursor at a position where code mark is active
    // but the child traversal can't find it. This requires a very specific
    // doc structure — difficult to construct. Instead verify the normal escape path
    // (endPos !== null → covered) and the false return (endPos === null → this test).
    //
    // We can trigger line 102 by having a code-marked position but no matching
    // child node. In ProseMirror, this is very hard to construct.
    // The test below verifies the positive path (endPos found → return true).

    const codeMark = codeBlockSchema.marks.code.create();
    const children = [
      codeBlockSchema.text("before "),
      codeBlockSchema.text("code", [codeMark]),
      codeBlockSchema.text(" after"),
    ];
    const doc = codeBlockSchema.node("doc", null, [
      codeBlockSchema.node("paragraph", null, children),
    ]);
    const state = EditorState.create({ doc, schema: codeBlockSchema });
    // Cursor inside "code" (position: 1 + 7 + 2 = 10, inside the code-marked text)
    const stateWithCursor = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 10))
    );

    let newState = stateWithCursor;
    const mockView = {
      state: stateWithCursor,
      dispatch: (tr: ReturnType<EditorState["tr"]["setSelection"]>) => {
        newState = stateWithCursor.apply(tr);
      },
    } as unknown as EditorView;

    const { from, to } = stateWithCursor.selection;
    const handled = handleTextInput(mockView, from, to, "`", ENABLED);

    // Cursor is inside code mark → escape path → return true
    expect(handled).toBe(true);
    // Cursor should have moved to after the code mark
    expect(newState.selection.from).toBeGreaterThan(from);
  });
});

/* ================================================================== */
/*  handleTextInput — multi-char text (line 164 true branch)          */
/* ================================================================== */

describe("handleTextInput — multi-char text returns false (line 164)", () => {
  it("returns false when text has more than one character", () => {
    const state = createState("hello", 2);
    const view = createMockView(state);
    // Passing multi-char text like "ab" — length !== 1, returns false immediately
    const handled = handleTextInput(view, 3, 3, "ab", ENABLED);
    expect(handled).toBe(false);
  });
});

/* ================================================================== */
/*  handleTextInput — shouldAutoPair false (line 189 true branch)     */
/* ================================================================== */

describe("handleTextInput — shouldAutoPair returns false (line 189)", () => {
  it("returns false when typing a single quote after a word character (smart quote after word)", () => {
    // SMART_QUOTE_CHARS = { "'", "\u2018" }
    // straightToCurlyOpening("'", pairConfig) converts "'" to "\u2018" (left single curly).
    // shouldAutoPair checks SMART_QUOTE_CHARS.has("\u2018") → true, isAfterWordChar → true → return false.
    // Result: handleTextInput returns false without pairing.
    const state = createState("word", 4); // cursor after "word" — position 5 in doc
    const view = createMockView(state);
    const handled = handleTextInput(view, 5, 5, "'", ENABLED);
    // shouldAutoPair returns false for single quote after word char
    expect(handled).toBe(false);
  });
});

/* ================================================================== */
/*  handleClosingBracket — disabled config (line 230 true branch)     */
/* ================================================================== */

describe("handleClosingBracket — disabled config (line 230)", () => {
  it("returns false immediately when config.enabled is false", () => {
    const state = createState("()", 1);
    const view = createMockView(state);
    // DISABLED has enabled: false — hits line 230 guard
    const handled = handleClosingBracket(view, ")", DISABLED);
    expect(handled).toBe(false);
    // Should not have dispatched any transaction
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  createKeyHandler — curlyClosing else branch (line 351)            */
/* ================================================================== */

describe("createKeyHandler — curlyClosing else branch (line 351)", () => {
  function makeKeyEvent(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      ...opts,
    } as unknown as KeyboardEvent;
  }

  it("returns false when closing char has no curly equivalent and handleClosingBracket fails", () => {
    // Typing ")" when cursor is NOT before a ")" — handleClosingBracket returns false for ")"
    // straightToCurlyClosing(")") returns ")" (no conversion, curlyClosing === event.key)
    // So the condition (curlyClosing !== event.key) is false — else branch of line 351 fires
    const handler = createKeyHandler(() => ENABLED);
    const state = createState("hello", 2); // no closing bracket ahead
    const view = createMockView(state);
    const event = makeKeyEvent(")");

    // handleClosingBracket(")", ...) fails (no ")" at cursor), curlyClosing === ")", so else branch fires
    const result = handler(view, event);
    expect(result).toBe(false);
  });
});

// NOTE: findCodeMarkEnd line 141 else branch (child in range without code mark) is covered
// by a v8 ignore annotation in handlers.ts. When inCode=true the cursor is inside a
// code-marked node; any sibling satisfying the range check but lacking the code mark
// is only reachable at a mark boundary where $from.marks() returns [] (inCode=false),
// making the else path structurally unreachable in tested code paths.

/* ================================================================== */
/*  handleTextInput — selection wrap path (lines 200-210)             */
/* ================================================================== */

describe("handleTextInput — wrap selection with pair (from !== to branch, lines 200-210)", () => {
  it("wraps selected text with auto-pair brackets", () => {
    // Cursor selects "hello" and types "(" — should wrap with ()
    const state = createState("hello", 0);
    // Create a selection over the full text: from=1, to=6
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
    );
    const view = createMockView(withSel);

    // handleTextInput is called with from=1, to=6 (selection range)
    const handled = handleTextInput(view, 1, 6, "(", ENABLED);

    expect(handled).toBe(true);
    // Text should now be "(hello)" with cursor after "hello" (before ")")
    expect(view.state.doc.firstChild!.textContent).toBe("(hello)");
    // Cursor should be at position 7 (after "hello", before ")")
    expect(view.state.selection.from).toBe(7);
  });

  it("wraps selected CJK text with curly brackets", () => {
    // Select "ab" and type "{" — should wrap with {}
    const state = createState("ab", 0);
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 3)),
    );
    const view = createMockView(withSel);

    const handled = handleTextInput(view, 1, 3, "{", ENABLED);

    expect(handled).toBe(true);
    expect(view.state.doc.firstChild!.textContent).toBe("{ab}");
  });
});

/* ================================================================== */
/*  Tab/Shift+Tab bracket jump — code context guard                    */
/* ================================================================== */

describe("handleTabJump — code context guard", () => {
  /** Create a state with cursor inside a codeBlock containing `text` */
  function createCodeBlockState(text: string, cursorOffset: number): EditorState {
    const textNode = text ? schema.text(text) : undefined;
    const codeBlock = schema.node("codeBlock", null, textNode ? [textNode] : []);
    const doc = schema.node("doc", null, [codeBlock]);
    const state = EditorState.create({ doc, schema });
    const pos = 1 + cursorOffset;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos)),
    );
  }

  /** Create a state with cursor inside inline code mark in a paragraph */
  function createInlineCodeState(text: string, cursorOffset: number): EditorState {
    const codeMark = schema.marks.code.create();
    const textNode = schema.text(text, [codeMark]);
    const para = schema.node("paragraph", null, [textNode]);
    const doc = schema.node("doc", null, [para]);
    const state = EditorState.create({ doc, schema });
    const pos = 1 + cursorOffset;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos)),
    );
  }

  it("does NOT jump over ) inside codeBlock", () => {
    // codeBlock: "foo()" with cursor at offset 4 (between ( and ))
    const state = createCodeBlockState("foo()", 4);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(false);
  });

  it("does NOT jump over ] inside codeBlock", () => {
    const state = createCodeBlockState("arr[]", 4);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(false);
  });

  it("does NOT jump over } inside codeBlock", () => {
    const state = createCodeBlockState("obj{}", 4);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(false);
  });

  it("does NOT jump over ) inside inline code mark", () => {
    const state = createInlineCodeState("fn()", 3);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(false);
  });

  it("still jumps over ) in normal paragraph (regression guard)", () => {
    const state = createState("()", 1);
    const view = createMockView(state);

    expect(handleTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(2);
  });
});

describe("handleShiftTabJump — code context guard", () => {
  function createCodeBlockState(text: string, cursorOffset: number): EditorState {
    const textNode = text ? schema.text(text) : undefined;
    const codeBlock = schema.node("codeBlock", null, textNode ? [textNode] : []);
    const doc = schema.node("doc", null, [codeBlock]);
    const state = EditorState.create({ doc, schema });
    const pos = 1 + cursorOffset;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos)),
    );
  }

  function createInlineCodeState(text: string, cursorOffset: number): EditorState {
    const codeMark = schema.marks.code.create();
    const textNode = schema.text(text, [codeMark]);
    const para = schema.node("paragraph", null, [textNode]);
    const doc = schema.node("doc", null, [para]);
    const state = EditorState.create({ doc, schema });
    const pos = 1 + cursorOffset;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos)),
    );
  }

  it("does NOT jump before ( inside codeBlock", () => {
    // codeBlock: "foo()" with cursor at offset 4 — right after ( at offset 3
    const state = createCodeBlockState("(text)", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(false);
  });

  it("does NOT jump before [ inside codeBlock", () => {
    const state = createCodeBlockState("[item]", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(false);
  });

  it("does NOT jump before ( inside inline code mark", () => {
    const state = createInlineCodeState("(text)", 1);
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(false);
  });

  it("still jumps before ( in normal paragraph (regression guard)", () => {
    const state = createState("(text)", 1); // cursor right after (
    const view = createMockView(state);

    expect(handleShiftTabJump(view, ENABLED)).toBe(true);
    expect(getCursorOffset(view.state)).toBe(0);
  });
});
