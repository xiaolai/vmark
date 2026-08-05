/**
 * Auto-Pair Utils Tests
 *
 * Tests for isInCodeBlock, isInInlineCode, isAfterWordChar,
 * shouldAutoPair, getCharAt, and getCharBefore.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  isInCodeBlock,
  isInInlineCode,
  isAfterWordChar,
  shouldAutoPair,
  getCharAt,
  getCharBefore,
} from "./utils";

/* ------------------------------------------------------------------ */
/*  Schema & helpers                                                   */
/* ------------------------------------------------------------------ */

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    codeBlock: { content: "text*", group: "block", code: true },
    text: { inline: true, group: "inline" },
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

function createCodeBlockState(text: string, cursorOffset?: number): EditorState {
  const textNode = text ? schema.text(text) : undefined;
  const codeBlock = schema.node("codeBlock", null, textNode ? [textNode] : []);
  const doc = schema.node("doc", null, [codeBlock]);
  const state = EditorState.create({ doc, schema });

  if (cursorOffset !== undefined) {
    const pos = 1 + cursorOffset;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos)),
    );
  }
  return state;
}

function createInlineCodeState(
  before: string,
  code: string,
  after: string,
  cursorInCode: number,
): EditorState {
  const codeMark = schema.marks.code.create();
  const children = [];
  if (before) children.push(schema.text(before));
  if (code) children.push(schema.text(code, [codeMark]));
  if (after) children.push(schema.text(after));

  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, children),
  ]);
  const state = EditorState.create({ doc, schema });
  const pos = 1 + before.length + cursorInCode;
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos)),
  );
}

/* ================================================================== */
/*  isInCodeBlock                                                      */
/* ================================================================== */

describe("isInCodeBlock", () => {
  it("returns false in a regular paragraph", () => {
    const state = createState("hello", 0);
    expect(isInCodeBlock(state)).toBe(false);
  });

  it("returns true inside a codeBlock node", () => {
    const state = createCodeBlockState("let x = 1;", 0);
    expect(isInCodeBlock(state)).toBe(true);
  });

  it("returns true with cursor in middle of code block", () => {
    const state = createCodeBlockState("let x = 1;", 5);
    expect(isInCodeBlock(state)).toBe(true);
  });

  it("returns false in empty paragraph", () => {
    const state = createState("", 0);
    expect(isInCodeBlock(state)).toBe(false);
  });
});

/* ================================================================== */
/*  isInInlineCode                                                     */
/* ================================================================== */

describe("isInInlineCode", () => {
  it("returns false when not in inline code", () => {
    const state = createState("hello", 2);
    expect(isInInlineCode(state)).toBe(false);
  });

  it("returns true when cursor is inside code mark", () => {
    const state = createInlineCodeState("say ", "hello", " world", 2);
    expect(isInInlineCode(state)).toBe(true);
  });

  it("returns false when cursor is outside code mark", () => {
    const _state = createInlineCodeState("say ", "hello", " world", -4);
    // Cursor is at position 1 (before "say"), so offset = -4 would be invalid
    // Use a proper position: cursor before inline code
    const state2 = createInlineCodeState("say ", "hello", " world", -3);
    // This positions cursor at 1 + 4 + (-3) = 2, inside "say " text
    expect(isInInlineCode(state2)).toBe(false);
  });

  it("returns false in empty paragraph", () => {
    const state = createState("", 0);
    expect(isInInlineCode(state)).toBe(false);
  });
});

/* ================================================================== */
/*  isAfterWordChar                                                    */
/* ================================================================== */

describe("isAfterWordChar", () => {
  it("returns false at position 0", () => {
    const state = createState("hello", 0);
    expect(isAfterWordChar(state, 0)).toBe(false);
  });

  it("returns true after a letter", () => {
    const state = createState("hello", 3);
    // pos = 4 (1+3), check if char before pos 4 is a word char
    expect(isAfterWordChar(state, 4)).toBe(true);
  });

  it("returns true after a digit", () => {
    const state = createState("abc123", 4);
    expect(isAfterWordChar(state, 5)).toBe(true);
  });

  it("returns true after underscore", () => {
    const state = createState("a_b", 2);
    expect(isAfterWordChar(state, 3)).toBe(true);
  });

  it("returns false after a space", () => {
    const state = createState("a b", 2);
    expect(isAfterWordChar(state, 3)).toBe(false);
  });

  it("returns false after an opening bracket", () => {
    const state = createState("(", 1);
    expect(isAfterWordChar(state, 2)).toBe(false);
  });

  it("returns true after CJK character (Chinese)", () => {
    const state = createState("\u4f60\u597d", 1); // Chinese chars
    expect(isAfterWordChar(state, 2)).toBe(true);
  });

  it("returns true after CJK character (Japanese hiragana)", () => {
    const state = createState("\u3042", 1); // Hiragana 'a'
    expect(isAfterWordChar(state, 2)).toBe(true);
  });

  it("returns true after CJK character (Japanese katakana)", () => {
    const state = createState("\u30A2", 1); // Katakana 'a'
    expect(isAfterWordChar(state, 2)).toBe(true);
  });

  it("returns true after Korean character", () => {
    const state = createState("\uAC00", 1); // Korean syllable
    expect(isAfterWordChar(state, 2)).toBe(true);
  });

  it("returns false for negative position", () => {
    const state = createState("hello", 0);
    expect(isAfterWordChar(state, -1)).toBe(false);
  });
});

/* ================================================================== */
/*  shouldAutoPair                                                     */
/* ================================================================== */

describe("shouldAutoPair", () => {
  it("returns true for opening bracket in normal paragraph", () => {
    const state = createState("", 0);
    expect(shouldAutoPair(state, 1, "(")).toBe(true);
  });

  it("returns false inside code block", () => {
    const state = createCodeBlockState("", 0);
    expect(shouldAutoPair(state, 1, "(")).toBe(false);
  });

  it("returns false inside inline code", () => {
    const state = createInlineCodeState("", "code", "", 2);
    expect(shouldAutoPair(state, 3, "(")).toBe(false);
  });

  it("returns false for smart quote after word character", () => {
    // Simulates typing ' after "it" -> should not pair (it's an apostrophe)
    const state = createState("it", 2);
    expect(shouldAutoPair(state, 3, "'")).toBe(false);
  });

  it("returns true for smart quote at start of text", () => {
    const state = createState("", 0);
    expect(shouldAutoPair(state, 1, "'")).toBe(true);
  });

  it("returns false for curly single quote after word char", () => {
    const state = createState("it", 2);
    expect(shouldAutoPair(state, 3, "\u2018")).toBe(false);
  });

  it("returns false when preceded by backslash (escaped)", () => {
    const state = createState("\\", 1);
    expect(shouldAutoPair(state, 2, "(")).toBe(false);
  });

  it("returns true when preceded by non-backslash char", () => {
    const state = createState("a", 1);
    expect(shouldAutoPair(state, 2, "(")).toBe(true);
  });

  it("returns true for double quote (not a smart quote char)", () => {
    const state = createState("word", 4);
    expect(shouldAutoPair(state, 5, '"')).toBe(true);
  });

  it("returns true at document start (pos = 0, no backslash check)", () => {
    const state = createState("", 0);
    // pos 1 is start of paragraph content
    expect(shouldAutoPair(state, 1, "(")).toBe(true);
  });
});

/* ================================================================== */
/*  getCharAt                                                          */
/* ================================================================== */

describe("getCharAt", () => {
  it("returns character at the given position", () => {
    const state = createState("hello", 0);
    expect(getCharAt(state, 1)).toBe("h");
    expect(getCharAt(state, 2)).toBe("e");
    expect(getCharAt(state, 5)).toBe("o");
  });

  it("returns empty string for position beyond document", () => {
    const state = createState("hi", 0);
    expect(getCharAt(state, 100)).toBe("");
  });

  it("returns empty string for negative position", () => {
    const state = createState("hi", 0);
    expect(getCharAt(state, -1)).toBe("");
  });

  it("returns empty string at end of content (boundary)", () => {
    const state = createState("ab", 0);
    // Position 3 is after 'b', position 4 is paragraph end
    expect(getCharAt(state, 3)).toBe("");
  });

  it("handles empty paragraph", () => {
    const state = createState("", 0);
    expect(getCharAt(state, 1)).toBe("");
  });

  it("handles CJK characters", () => {
    const state = createState("\u4f60\u597d", 0);
    expect(getCharAt(state, 1)).toBe("\u4f60");
    expect(getCharAt(state, 2)).toBe("\u597d");
  });
});

/* ================================================================== */
/*  getCharBefore                                                      */
/* ================================================================== */

describe("getCharBefore", () => {
  it("returns character before the given position", () => {
    const state = createState("hello", 0);
    expect(getCharBefore(state, 2)).toBe("h");
    expect(getCharBefore(state, 3)).toBe("e");
  });

  it("returns empty string at position 0", () => {
    const state = createState("hello", 0);
    expect(getCharBefore(state, 0)).toBe("");
  });

  it("returns empty string for negative position", () => {
    const state = createState("hello", 0);
    expect(getCharBefore(state, -1)).toBe("");
  });

  it("returns last character at end of text", () => {
    const state = createState("ab", 0);
    expect(getCharBefore(state, 3)).toBe("b");
  });

  it("handles CJK characters", () => {
    const state = createState("\u4f60\u597d", 0);
    expect(getCharBefore(state, 2)).toBe("\u4f60");
    expect(getCharBefore(state, 3)).toBe("\u597d");
  });

  it("returns empty string at start of paragraph content", () => {
    const state = createState("hello", 0);
    // Position 1 is start of paragraph content; parentOffset is 0
    expect(getCharBefore(state, 1)).toBe("");
  });
});
