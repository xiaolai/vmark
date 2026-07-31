/**
 * Real-document tests for the WYSIWYG line operations.
 *
 * The sibling suite (`wysiwygAdapterBlockOps.test.ts`) mocks the document and
 * the transaction, so it can prove a handler dispatched SOMETHING but never
 * what the document became. Both defects pinned here were invisible to it:
 *   - removing a "blank line" that is an empty list item deleted only the
 *     paragraph inside it, which ProseMirror's replace-fitter immediately
 *     re-inserted (listItem requires a block) — a dispatched no-op reported
 *     as success;
 *   - a paragraph holding hardBreak nodes is SEVERAL markdown lines, but the
 *     operations moved/deleted/duplicated the whole paragraph.
 */
import { describe, it, expect, vi } from "vitest";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import {
  handleWysiwygDeleteBlock,
  handleWysiwygDuplicateBlock,
  handleWysiwygMoveBlockDown,
  handleWysiwygMoveBlockUp,
  handleWysiwygRemoveBlankLines,
} from "./wysiwygAdapterBlockOps";
import type { WysiwygToolbarContext } from "./types";

const s = testSchema;
const doc = (...blocks: PMNode[]) => s.node("doc", null, blocks);
const p = (...content: PMNode[]) => s.node("paragraph", null, content);
const text = (t: string) => s.text(t);
const bold = (t: string) => s.text(t, [s.marks.bold.create()]);
const br = () => s.node("hardBreak");
const li = (...blocks: PMNode[]) => s.node("listItem", null, blocks);
const ul = (...items: PMNode[]) => s.node("bulletList", null, items);
const bq = (...blocks: PMNode[]) => s.node("blockquote", null, blocks);
const cell = (...blocks: PMNode[]) => s.node("tableCell", null, blocks);
const row = (...cells: PMNode[]) => s.node("tableRow", null, cells);
const table = (...rows: PMNode[]) => s.node("table", null, rows);

function makeContext(startDoc: PMNode, from: number, to?: number) {
  let state = EditorState.create({
    doc: startDoc,
    selection: TextSelection.create(startDoc, from, to ?? from),
  });
  const dispatch = vi.fn((tr: Transaction) => {
    state = state.apply(tr);
  });
  const focus = vi.fn();
  const context = {
    surface: "wysiwyg",
    view: { state, dispatch } as never,
    editor: { commands: { focus } } as never,
    context: null,
  } as WysiwygToolbarContext;
  return { context, doc: () => state.doc, dispatch, state: () => state };
}

describe("handleWysiwygRemoveBlankLines — real documents", () => {
  it("removes an empty list item, not just the paragraph inside it", () => {
    const start = doc(ul(li(p(text("one"))), li(p()), li(p(text("three")))));
    const h = makeContext(start, 3, 19);

    expect(handleWysiwygRemoveBlankLines(h.context)).toBe(true);
    // The replace-fitter used to re-grow the deleted paragraph (listItem
    // requires a block), leaving the document IDENTICAL while the handler
    // claimed success.
    expect(h.doc().eq(start)).toBe(false);
    expect(h.doc().eq(doc(ul(li(p(text("one"))), li(p(text("three"))))))).toBe(true);
  });

  it("removes a blockquote whose only content is an empty paragraph", () => {
    const start = doc(p(text("before")), bq(p()), p(text("after")));
    const h = makeContext(start, 1, 19);

    expect(handleWysiwygRemoveBlankLines(h.context)).toBe(true);
    expect(h.doc().eq(doc(p(text("before")), p(text("after"))))).toBe(true);
  });

  it("leaves an empty paragraph inside a table cell alone", () => {
    // An empty paragraph in a cell is an empty CELL, not a blank markdown
    // line — Source mode's removeBlankLines never sees one, and widening the
    // deletion would take the cell itself out of the row.
    const start = doc(table(row(cell(p(text("x"))), cell(p()))), p(text("after")));
    const h = makeContext(start, 4, 19);

    expect(handleWysiwygRemoveBlankLines(h.context)).toBe(true);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.doc().eq(start)).toBe(true);
  });

  it("deletes a bare empty paragraph between filled ones", () => {
    const start = doc(p(text("one")), p(), p(text("two")));
    const h = makeContext(start, 1, 10);

    expect(handleWysiwygRemoveBlankLines(h.context)).toBe(true);
    expect(h.doc().eq(doc(p(text("one")), p(text("two"))))).toBe(true);
  });
});

describe("hard-break paragraphs: one visual line is the unit", () => {
  // p("alpha", br, "beta", br, "gamma") — three lines in one textblock.
  // Doc positions: "alpha" 1..6, break 6..7, "beta" 7..11, break 11..12,
  // "gamma" 12..17.
  const threeLine = () => doc(p(text("alpha"), br(), text("beta"), br(), text("gamma")));

  it("deleteLine removes only the line at the cursor (middle line)", () => {
    const h = makeContext(threeLine(), 8);
    expect(handleWysiwygDeleteBlock(h.context)).toBe(true);
    expect(h.doc().eq(doc(p(text("alpha"), br(), text("gamma"))))).toBe(true);
  });

  it("deleteLine on the first line consumes the delimiter after it", () => {
    const h = makeContext(threeLine(), 2);
    expect(handleWysiwygDeleteBlock(h.context)).toBe(true);
    expect(h.doc().eq(doc(p(text("beta"), br(), text("gamma"))))).toBe(true);
  });

  it("duplicateLine copies only the line at the cursor", () => {
    const h = makeContext(threeLine(), 8);
    expect(handleWysiwygDuplicateBlock(h.context)).toBe(true);
    expect(
      h.doc().eq(doc(p(text("alpha"), br(), text("beta"), br(), text("beta"), br(), text("gamma"))))
    ).toBe(true);
  });

  it("moveLineUp swaps the line with the one above it", () => {
    const h = makeContext(threeLine(), 8);
    expect(handleWysiwygMoveBlockUp(h.context)).toBe(true);
    expect(h.doc().eq(doc(p(text("beta"), br(), text("alpha"), br(), text("gamma"))))).toBe(true);
  });

  it("moveLineDown swaps the line with the one below it", () => {
    const h = makeContext(threeLine(), 8);
    expect(handleWysiwygMoveBlockDown(h.context)).toBe(true);
    expect(h.doc().eq(doc(p(text("alpha"), br(), text("gamma"), br(), text("beta"))))).toBe(true);
  });

  it("moveLineUp refuses on the first line of the block", () => {
    const h = makeContext(threeLine(), 2);
    expect(handleWysiwygMoveBlockUp(h.context)).toBe(false);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("moveLineDown refuses on the last line of the block", () => {
    const h = makeContext(threeLine(), 13);
    expect(handleWysiwygMoveBlockDown(h.context)).toBe(false);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("a line swap carries marks with the moved line", () => {
    const start = doc(p(bold("one"), br(), text("two")));
    const h = makeContext(start, 6);
    expect(handleWysiwygMoveBlockUp(h.context)).toBe(true);
    expect(h.doc().eq(doc(p(text("two"), br(), bold("one"))))).toBe(true);
  });
});
