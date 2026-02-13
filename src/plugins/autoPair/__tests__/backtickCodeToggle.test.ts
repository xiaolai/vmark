/**
 * Backtick Code Mark Toggle Tests (Issue #58 Problem 2)
 *
 * Verifies that backtick in WYSIWYG mode toggles inline code mark
 * instead of inserting backtick text.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { handleTextInput, type AutoPairConfig } from "../handlers";

// Minimal schema with code mark
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
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

const defaultConfig: AutoPairConfig = {
  enabled: true,
  includeCJK: false,
  includeCurlyQuotes: false,
  normalizeRightDoubleQuote: false,
};

function createState(text: string, cursorPos?: number): EditorState {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  const state = EditorState.create({ doc });
  if (cursorPos != null) {
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, cursorPos))
    );
  }
  return state;
}

function createStateWithCodeMark(
  before: string,
  code: string,
  after: string,
  cursorInCode?: number
): EditorState {
  const codeMark = schema.marks.code.create();
  const children = [];
  if (before) children.push(schema.text(before));
  if (code) children.push(schema.text(code, [codeMark]));
  if (after) children.push(schema.text(after));

  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, children),
  ]);
  const state = EditorState.create({ doc });

  if (cursorInCode != null) {
    // Position: 1 (paragraph start) + before.length + cursorInCode
    const pos = 1 + before.length + cursorInCode;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos))
    );
  }
  return state;
}

/**
 * Call handleTextInput with a mock EditorView.
 * Returns the resulting EditorState if handled, or null if not handled.
 */
function callHandleTextInput(
  state: EditorState,
  text: string,
  config = defaultConfig
): { handled: boolean; newState: EditorState } {
  let newState = state;
  const mockView = {
    state,
    dispatch: (tr: ReturnType<EditorState["tr"]["setSelection"]>) => {
      newState = state.apply(tr);
    },
  } as unknown as EditorView;

  const { from, to } = state.selection;
  const handled = handleTextInput(mockView, from, to, text, config);
  return { handled, newState };
}

describe("backtick code mark toggle (WYSIWYG)", () => {
  it("activates code mark when typing backtick outside code", () => {
    // Cursor at position 1 (start of paragraph content)
    const state = createState("", 1);
    const { handled, newState } = callHandleTextInput(state, "`");

    expect(handled).toBe(true);
    // Should NOT insert backtick text
    expect(newState.doc.textContent).toBe("");
    // Should have code mark in stored marks
    const storedMarks = newState.storedMarks;
    expect(storedMarks).not.toBeNull();
    expect(storedMarks?.some((m) => m.type.name === "code")).toBe(true);
  });

  it("wraps selection with code mark when backtick typed with selection", () => {
    // Create state with "hello" selected
    const state = createState("hello");
    const withSelection = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 6))
    );

    const { handled, newState } = callHandleTextInput(withSelection, "`");

    expect(handled).toBe(true);
    // Text should still be "hello"
    expect(newState.doc.textContent).toBe("hello");
    // "hello" should have code mark
    const para = newState.doc.firstChild!;
    const firstChild = para.firstChild!;
    expect(firstChild.marks.some((m) => m.type.name === "code")).toBe(true);
  });

  it("escapes code mark when typing backtick inside code", () => {
    // "hello" with code mark, cursor at end (position 6 = 1 + 5)
    const state = createStateWithCodeMark("", "hello", " world", 5);

    const { handled, newState } = callHandleTextInput(state, "`");

    expect(handled).toBe(true);
    // Should NOT insert backtick text
    expect(newState.doc.textContent).toBe("hello world");
    // Cursor should be after the code mark
    expect(newState.selection.from).toBe(6); // After "hello"
  });

  it("does not handle backtick when auto-pair is disabled", () => {
    const state = createState("", 1);
    const { handled } = callHandleTextInput(state, "`", {
      ...defaultConfig,
      enabled: false,
    });

    expect(handled).toBe(false);
  });

  it("does not handle backtick after escape backslash", () => {
    const state = createState("\\", 2); // Cursor after backslash
    const { handled } = callHandleTextInput(state, "`");

    expect(handled).toBe(false);
  });
});
