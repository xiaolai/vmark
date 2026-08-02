/**
 * Changing a list's TYPE applies to the whole list.
 *
 * Source used to rewrite only the marker on the cursor's line, so putting the
 * caret in item 2 of a bullet list and pressing "Ordered List" produced
 * `- one` / `1. two` / `- three` — three separate lists, not one converted one.
 * WYSIWYG has always converted the whole list, and `shared/blockSpan` records
 * the rule this follows: a list is ONE block.
 *
 * @coordinates-with listBlockConversion.ts — convertListBlock
 * @module plugins/sourceContextDetection/listBlockConversion.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { convertListBlock } from "./listBlockConversion";

const views: EditorView[] = [];

function createView(doc: string, cursor: number): EditorView {
  const parent = document.createElement("div");
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.cursor(cursor)]) }),
    parent,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.forEach((v) => {
    try {
      v.destroy();
    } catch {
      /* already destroyed */
    }
  });
  views.length = 0;
});

describe("convertListBlock", () => {
  it("converts EVERY item, not just the cursor's line", () => {
    const view = createView("- one\n- two\n- three", 8);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. one\n2. two\n3. three");
  });

  it("numbers sequentially from the top of the list", () => {
    const view = createView("- a\n- b\n- c\n- d", 2);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. a\n2. b\n3. c\n4. d");
  });

  // With the caret in a NESTED item, only that sub-list converts. Rewriting the
  // whole outer list would change siblings the user never pointed at, and it is
  // the innermost enclosing list that WYSIWYG converts.
  it("converts only the sub-list when the caret is nested", () => {
    const view = createView("- outer\n  - inner\n- last", 12);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("- outer\n  1. inner\n- last");
  });

  it("converts the whole structure when the selection spans the outer level", () => {
    const doc = "- outer\n  - inner\n- last";
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.range(0, doc.length)]) }),
      parent,
    });
    views.push(view);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. outer\n  1. inner\n2. last");
  });

  it("numbers each nesting level independently", () => {
    const doc = "- a\n  - a1\n- b\n  - b1";
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.range(0, doc.length)]) }),
      parent,
    });
    views.push(view);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. a\n  1. a1\n2. b\n  1. b1");
  });

  it("converts to task items", () => {
    const view = createView("- one\n- two", 2);
    convertListBlock(view, "task");
    expect(view.state.doc.toString()).toBe("- [ ] one\n- [ ] two");
  });

  it("converts ordered back to bullet", () => {
    const view = createView("1. one\n2. two", 3);
    convertListBlock(view, "bullet");
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("preserves a task item's CHECKED state when converting to task", () => {
    const view = createView("- [x] done\n- todo", 2);
    convertListBlock(view, "task");
    expect(view.state.doc.toString()).toBe("- [x] done\n- [ ] todo");
  });

  it("drops the checkbox when converting a task list to bullets", () => {
    const view = createView("- [x] done\n- [ ] todo", 2);
    convertListBlock(view, "bullet");
    expect(view.state.doc.toString()).toBe("- done\n- todo");
  });

  it("preserves indentation", () => {
    const view = createView("  - a\n  - b", 4);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("  1. a\n  2. b");
  });

  it("leaves a non-list line untouched", () => {
    const view = createView("plain text", 2);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("plain text");
  });

  it("crosses a blank line, because that is still ONE list", () => {
    // CommonMark: a blank line between items of the same marker makes the list
    // LOOSE, it does not end it. Treating the blank as a boundary would convert
    // half a list and leave the other half behind.
    const view = createView("- one\n- two\n\n- other", 2);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. one\n2. two\n\n3. other");
  });

  it("handles CJK content", () => {
    const view = createView("- 中文一\n- 中文二", 3);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. 中文一\n2. 中文二");
  });

  it("is idempotent when the list is already the target type", () => {
    const view = createView("1. one\n2. two", 3);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. one\n2. two");
  });

  // "1. [x] done" is a valid GFM task item. Recognising only BULLET tasks
  // turned it into "- [ ] [x] done" — checkbox duplicated, state lost.
  it("preserves an ORDERED task's checkbox when converting to task", () => {
    const view = createView("1. [x] done\n2. [ ] todo", 3);
    convertListBlock(view, "task");
    expect(view.state.doc.toString()).toBe("- [x] done\n- [ ] todo");
  });

  it("consumes the checkbox when converting an ordered task to bullets", () => {
    const view = createView("1. [x] done\n2. todo", 3);
    convertListBlock(view, "bullet");
    expect(view.state.doc.toString()).toBe("- done\n- todo");
  });

  // CommonMark: "- one" / "* two" is TWO lists; converting the first must not
  // destructively rewrite the second.
  it("converts only the cursor's list when the bullet char changes", () => {
    const view = createView("- one\n* two", 2);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. one\n* two");
  });

  it("leaves a spaced thematic break untouched", () => {
    const view = createView("- a\n* * *\n- b", 2);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. a\n* * *\n- b");
  });

  it("carries a continuation paragraph through unchanged", () => {
    const view = createView("- one\n  continuation\n- two", 2);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. one\n  continuation\n2. two");
  });

  // A blank line inside the selection has indent zero; deriving the base
  // indent from it widened a nested conversion to the whole outer list.
  it("keeps a nested conversion nested when the selection spans a blank line", () => {
    const doc = "- outer\n  - a\n\n  - b\n- last";
    const parent = document.createElement("div");
    const selFrom = doc.indexOf("  - a");
    const selTo = doc.indexOf("  - b") + "  - b".length;
    const view = new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.range(selFrom, selTo)]) }),
      parent,
    });
    views.push(view);
    convertListBlock(view, "ordered");
    expect(view.state.doc.toString()).toBe("- outer\n  1. a\n\n  2. b\n- last");
  });
});
