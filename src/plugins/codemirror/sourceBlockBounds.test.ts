// @vitest-environment node
/**
 * #1418 — what "the current block" means in Source mode.
 *
 * WYSIWYG can ask ProseMirror for the enclosing textblock. Source mode has no
 * node tree, only text, so a markdown block is what the format says it is: a
 * run of contiguous non-blank lines. Blank lines are separators, not content.
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { getMarkdownBlockBounds } from "./sourceBlockBounds";

const doc = (text: string) => EditorState.create({ doc: text });

/** Offset of the first character of line `n` (1-based). */
function lineStart(state: EditorState, n: number): number {
  return state.doc.line(n).from;
}

describe("getMarkdownBlockBounds", () => {
  it("bounds the middle paragraph, not the whole document", () => {
    const state = doc("first para\n\nsecond para\n\nthird para");
    const bounds = getMarkdownBlockBounds(state, lineStart(state, 3));
    expect(state.doc.sliceString(bounds!.from, bounds!.to)).toBe("second para");
  });

  it("spans every line of a multi-line paragraph", () => {
    const state = doc("alpha\nbeta\ngamma\n\nother");
    const bounds = getMarkdownBlockBounds(state, lineStart(state, 2));
    expect(state.doc.sliceString(bounds!.from, bounds!.to)).toBe("alpha\nbeta\ngamma");
  });

  it("stops at the document start without running off the top", () => {
    const state = doc("head line\nsecond\n\ntail");
    const bounds = getMarkdownBlockBounds(state, lineStart(state, 1));
    expect(state.doc.sliceString(bounds!.from, bounds!.to)).toBe("head line\nsecond");
  });

  it("stops at the document end without running off the bottom", () => {
    const state = doc("first\n\nlast one\nlast two");
    const bounds = getMarkdownBlockBounds(state, lineStart(state, 3));
    expect(state.doc.sliceString(bounds!.from, bounds!.to)).toBe("last one\nlast two");
  });

  /** A blank line separates blocks; it is not itself one. */
  it("returns null on a blank line", () => {
    const state = doc("para one\n\npara two");
    expect(getMarkdownBlockBounds(state, lineStart(state, 2))).toBeNull();
  });

  it("treats a whitespace-only line as blank", () => {
    const state = doc("para one\n   \npara two");
    expect(getMarkdownBlockBounds(state, lineStart(state, 2))).toBeNull();
  });

  /**
   * Inside a fence the fence wins, so the block command degrades to the
   * behaviour the document-wide command already has there — the two agree
   * rather than disagreeing about what "inside a code block" means.
   */
  it("uses the code fence when the cursor is inside one", () => {
    const state = doc("intro\n\n```js\nlet a = 1\n\nlet b = 2\n```\n\nouttro");
    const bounds = getMarkdownBlockBounds(state, lineStart(state, 4));
    const text = state.doc.sliceString(bounds!.from, bounds!.to);
    // Spans the blank line inside the fence — proving the fence, not the
    // blank-line rule, decided the bounds.
    expect(text).toContain("let a = 1");
    expect(text).toContain("let b = 2");
  });

  it("handles a single-line document", () => {
    const state = doc("only line");
    const bounds = getMarkdownBlockBounds(state, 2);
    expect(state.doc.sliceString(bounds!.from, bounds!.to)).toBe("only line");
  });

  it("returns null for an empty document", () => {
    expect(getMarkdownBlockBounds(doc(""), 0)).toBeNull();
  });
});
