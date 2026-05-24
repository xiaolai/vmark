import { vi, describe, it, expect } from "vitest";

vi.mock("@/utils/wordSegmentation", () => ({
  findWordBoundaries: vi.fn((text: string, offset: number) => {
    const wordRegex = /\w+/g;
    let match;
    while ((match = wordRegex.exec(text)) !== null) {
      if (offset >= match.index && offset <= match.index + match[0].length) {
        return { start: match.index, end: match.index + match[0].length };
      }
    }
    return null;
  }),
}));

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  findInlineMathAtCursor,
  findBlockMathAtCursor,
  insertInlineMath,
} from "./sourceMathActions";

function createView(doc: string, from: number, to?: number): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to ?? from),
  });
  return new EditorView({ state, parent });
}

describe("findInlineMathAtCursor", () => {
  it("finds inline math when cursor is inside $...$", () => {
    const view = createView("text $x^2$ more", 7);
    const result = findInlineMathAtCursor(view, 7);
    expect(result).toEqual({ from: 5, to: 10, content: "x^2" });
    view.destroy();
  });

  it("returns null when cursor is outside math", () => {
    const view = createView("text $x^2$ more", 2);
    const result = findInlineMathAtCursor(view, 2);
    expect(result).toBeNull();
    view.destroy();
  });

  it("ignores empty $$ pair — not inline math", () => {
    // Adjacent `$$` with nothing between is not inline math under remark-math
    // semantics and must not trigger the Source-mode math popup. Two `$`s with
    // no content are usually a half-typed block-math delimiter.
    const view = createView("text $$ more", 6);
    const result = findInlineMathAtCursor(view, 6);
    expect(result).toBeNull();
    view.destroy();
  });

  it("ignores trailing $$ at end of paragraph", () => {
    // Regression: typing `$$` at end of a non-`$$`-only line previously opened
    // the popup with empty content, which then wrote a stale range on Save.
    const view = createView("对我们来说，有价值的独立 agents。$$", 22);
    const result = findInlineMathAtCursor(view, 22);
    expect(result).toBeNull();
    view.destroy();
  });

  it("still matches non-empty math between $...$ on the same line", () => {
    const view = createView("intro $a$ $$ tail", 8);
    const result = findInlineMathAtCursor(view, 8);
    expect(result).toEqual({ from: 6, to: 9, content: "a" });
    view.destroy();
  });

  it("returns null when line is just $$ (block delimiter)", () => {
    const view = createView("$$", 1);
    const result = findInlineMathAtCursor(view, 1);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns null when no closing $ exists", () => {
    const view = createView("text $unclosed", 7);
    const result = findInlineMathAtCursor(view, 7);
    expect(result).toBeNull();
    view.destroy();
  });

  it("finds correct range with multiple math spans on same line", () => {
    const view = createView("$a$ and $b$", 9);
    const result = findInlineMathAtCursor(view, 9);
    expect(result).toEqual({ from: 8, to: 11, content: "b" });
    view.destroy();
  });

  it("finds first math span when cursor is in it", () => {
    const view = createView("$a$ and $b$", 1);
    const result = findInlineMathAtCursor(view, 1);
    expect(result).toEqual({ from: 0, to: 3, content: "a" });
    view.destroy();
  });

  it("detects cursor at opening delimiter boundary", () => {
    const view = createView("$x$", 0);
    const result = findInlineMathAtCursor(view, 0);
    expect(result).toEqual({ from: 0, to: 3, content: "x" });
    view.destroy();
  });

  it("detects cursor at closing delimiter boundary", () => {
    const view = createView("$x$", 3);
    const result = findInlineMathAtCursor(view, 3);
    expect(result).toEqual({ from: 0, to: 3, content: "x" });
    view.destroy();
  });

  it("handles math on second line", () => {
    const view = createView("first\n$y$ end", 8);
    const result = findInlineMathAtCursor(view, 8);
    expect(result).toEqual({ from: 6, to: 9, content: "y" });
    view.destroy();
  });
});

describe("findBlockMathAtCursor", () => {
  it("finds dollar block math when cursor is inside", () => {
    const doc = "$$\nx^2 + y^2\n$$";
    const view = createView(doc, 5);
    const result = findBlockMathAtCursor(view, 5);
    expect(result).toEqual({
      from: 0,
      to: doc.length,
      content: "x^2 + y^2",
      type: "dollarBlock",
    });
    view.destroy();
  });

  it("finds latex fence block when cursor is inside", () => {
    const doc = "```latex\nE = mc^2\n```";
    const view = createView(doc, 12);
    const result = findBlockMathAtCursor(view, 12);
    expect(result).toEqual({
      from: 0,
      to: doc.length,
      content: "E = mc^2",
      type: "latexFence",
    });
    view.destroy();
  });

  it("finds math fence block when cursor is inside", () => {
    const doc = "```math\nE = mc^2\n```";
    const view = createView(doc, 11);
    const result = findBlockMathAtCursor(view, 11);
    expect(result).toEqual({
      from: 0,
      to: doc.length,
      content: "E = mc^2",
      type: "latexFence",
    });
    view.destroy();
  });

  it("returns null when cursor is on $$ delimiter line", () => {
    const doc = "$$\nx^2\n$$";
    const view = createView(doc, 1);
    const result = findBlockMathAtCursor(view, 1);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns null when cursor is on closing ``` line", () => {
    const doc = "```latex\nE = mc^2\n```";
    const view = createView(doc, 19);
    const result = findBlockMathAtCursor(view, 19);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns null when cursor is on opening fence line", () => {
    const doc = "```latex\nE = mc^2\n```";
    const view = createView(doc, 3);
    const result = findBlockMathAtCursor(view, 3);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns null when no opening delimiter is found", () => {
    const view = createView("just plain text\nno math here", 5);
    const result = findBlockMathAtCursor(view, 5);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns null when no closing delimiter is found", () => {
    const doc = "$$\nx^2 + y^2\nno closing";
    const view = createView(doc, 5);
    const result = findBlockMathAtCursor(view, 5);
    expect(result).toBeNull();
    view.destroy();
  });

  it("handles multi-line content in block math", () => {
    const doc = "$$\nline1\nline2\nline3\n$$";
    const view = createView(doc, 12);
    const result = findBlockMathAtCursor(view, 12);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("line1\nline2\nline3");
    expect(result!.type).toBe("dollarBlock");
    view.destroy();
  });

  it("stops at non-latex fence when searching backwards", () => {
    const doc = "```python\ncode\n```\ntext\n$$\nmath\n$$";
    const view = createView(doc, 20);
    const result = findBlockMathAtCursor(view, 20);
    expect(result).toBeNull();
    view.destroy();
  });

  it("stops at another opening fence when searching forward inside latexFence block (line 133 break)", () => {
    // Cursor is inside a ```latex block, but a new ```python fence appears before the closing ```
    // The forward search should break on the new fence and return null (no close found)
    const doc = "```latex\ncontent\n```python\nmore\n```";
    // cursor at "content" line (position ~10)
    const view = createView(doc, 10);
    const result = findBlockMathAtCursor(view, 10);
    // closeLine is never found because forward search breaks on ```python
    expect(result).toBeNull();
    view.destroy();
  });
});

describe("insertInlineMath", () => {
  it("wraps selection in $...$", () => {
    const view = createView("hello world", 0, 5);
    const result = insertInlineMath(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("$hello$ world");
    expect(view.state.selection.main.head).toBe(7);
    view.destroy();
  });

  it("unwraps when cursor is inside inline math", () => {
    const view = createView("text $x^2$ end", 7);
    const result = insertInlineMath(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("text x^2 end");
    view.destroy();
  });

  it("wraps word at cursor when no selection", () => {
    const view = createView("hello world", 2);
    const result = insertInlineMath(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("$hello$ world");
    view.destroy();
  });

  it("inserts empty $$ when no selection and no word at cursor", () => {
    const view = createView("   ", 1);
    const result = insertInlineMath(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe(" $$  ");
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });

  it("places cursor after closing $ when wrapping selection", () => {
    const view = createView("abc", 0, 3);
    insertInlineMath(view);
    expect(view.state.doc.toString()).toBe("$abc$");
    expect(view.state.selection.main.head).toBe(5);
    view.destroy();
  });

  it("handles empty document", () => {
    const view = createView("", 0);
    insertInlineMath(view);
    expect(view.state.doc.toString()).toBe("$$");
    expect(view.state.selection.main.head).toBe(1);
    view.destroy();
  });

  it("unwraps empty math $$", () => {
    const view = createView("a $$ b", 3);
    const result = insertInlineMath(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("a  b");
    view.destroy();
  });

  it("handles selection at end of document", () => {
    const view = createView("end", 0, 3);
    insertInlineMath(view);
    expect(view.state.doc.toString()).toBe("$end$");
    view.destroy();
  });
});
