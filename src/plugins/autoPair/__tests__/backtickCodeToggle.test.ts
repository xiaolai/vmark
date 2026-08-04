/**
 * WI-1.1 — Backtick Code Mark Toggle Tests (Issue #58 Problem 2), on the
 * PRODUCTION schema.
 *
 * Verifies that backtick in WYSIWYG mode toggles inline code mark instead of
 * inserting backtick text. This file previously built a hand-written
 * snake_case schema (`code_block`), which is exactly how a production defect
 * stayed invisible: the shipped schema names the node `codeBlock`, so the
 * triple-backtick lookup `schema.nodes.code_block` returned undefined in the
 * real editor and the feature silently no-oped — while these tests passed
 * against their private schema. Plan ADR-3: editing tests run the production
 * stack; never a hand-built schema.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { getProductionSchema } from "@/test/productionSchema";
import { handleTextInput, type AutoPairConfig } from "../handlers";
import { resetBacktickState } from "../backtickToggle";

const schema = getProductionSchema();

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
  const children: Node[] = [];
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
  beforeEach(() => {
    resetBacktickState();
  });

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

  it("double backtick (consecutive) deactivates code mark", () => {
    const state = createState("", 1);

    // First backtick: activates code mark
    const { handled: h1, newState: s1 } = callHandleTextInput(state, "`");
    expect(h1).toBe(true);
    expect(s1.storedMarks?.some((m) => m.type.name === "code")).toBe(true);

    // Second backtick: deactivates code mark
    const { handled: h2, newState: s2 } = callHandleTextInput(s1, "`");
    expect(h2).toBe(true);
    // Code mark should be removed from stored marks
    const hasCode = s2.storedMarks?.some((m) => m.type.name === "code") ?? false;
    expect(hasCode).toBe(false);
  });

  it("triple backtick (consecutive) creates code block", () => {
    const state = createState("", 1);

    // First backtick
    const { newState: s1 } = callHandleTextInput(state, "`");
    // Second backtick
    const { newState: s2 } = callHandleTextInput(s1, "`");
    // Third backtick: creates code block
    const { handled: h3, newState: s3 } = callHandleTextInput(s2, "`");

    expect(h3).toBe(true);
    // Document should contain the production codeBlock node
    let hasCodeBlock = false;
    s3.doc.descendants((node) => {
      if (node.type.name === "codeBlock") hasCodeBlock = true;
    });
    expect(hasCodeBlock).toBe(true);
  });

  it("non-backtick input resets consecutive backtick count", () => {
    const state = createState("", 1);

    // First backtick: activates code mark
    const { newState: s1 } = callHandleTextInput(state, "`");
    expect(s1.storedMarks?.some((m) => m.type.name === "code")).toBe(true);

    // Reset (simulates non-backtick input calling resetBacktickState)
    resetBacktickState();

    // Next backtick should act as first again (activate code mark, not deactivate)
    const s1Clean = s1.apply(s1.tr);
    const { handled, newState: s2 } = callHandleTextInput(s1Clean, "`");
    expect(handled).toBe(true);
    expect(s2.storedMarks?.some((m) => m.type.name === "code")).toBe(true);
  });

  it("non-backtick input through handleTextInput resets consecutive count", () => {
    const state = createState("", 1);

    // First backtick: activates code mark
    const { newState: s1 } = callHandleTextInput(state, "`");
    expect(s1.storedMarks?.some((m) => m.type.name === "code")).toBe(true);

    // Type a non-backtick character — this should reset via handlers.ts wiring
    callHandleTextInput(s1, "a");

    // Next backtick should act as first again (activate, not deactivate)
    const s1Clean = s1.apply(s1.tr);
    const { handled, newState: s2 } = callHandleTextInput(s1Clean, "`");
    expect(handled).toBe(true);
    expect(s2.storedMarks?.some((m) => m.type.name === "code")).toBe(true);
  });

  it("500ms timeout resets consecutive backtick state", () => {
    vi.useFakeTimers();
    const state = createState("", 1);

    // First backtick: activates code mark
    const { newState: s1 } = callHandleTextInput(state, "`");
    expect(s1.storedMarks?.some((m) => m.type.name === "code")).toBe(true);

    // Advance past 500ms timeout
    vi.advanceTimersByTime(501);

    // Next backtick should act as first again (activate, not deactivate)
    const s1Clean = s1.apply(s1.tr);
    const { handled, newState: s2 } = callHandleTextInput(s1Clean, "`");
    expect(handled).toBe(true);
    expect(s2.storedMarks?.some((m) => m.type.name === "code")).toBe(true);

    vi.useRealTimers();
  });

  it("triple backtick inside code block is not handled", () => {
    // Create state with cursor inside the production codeBlock
    const codeBlockNode = schema.nodes.codeBlock.create(null, []);
    const doc = schema.node("doc", null, [codeBlockNode]);
    const state = EditorState.create({ doc });
    const stateWithCursor = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1))
    );

    const { handled } = callHandleTextInput(stateWithCursor, "`");
    expect(handled).toBe(false);
  });

});
