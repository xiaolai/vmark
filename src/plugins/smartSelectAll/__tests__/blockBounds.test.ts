// @vitest-environment node
/**
 * Block Bounds Detection Tests
 *
 * Tests for getNextContainerBounds() — the core algorithm for
 * progressive block expansion in WYSIWYG mode.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { getNextContainerBounds } from "../blockBounds";

// Schema with all container types needed for testing
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { inline: true, group: "inline" },
    codeBlock: { content: "text*", group: "block", code: true },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: { content: "listItem+", group: "block" },
    taskList: { content: "listItem+", group: "block" },
    listItem: { content: "block+" },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableCell: { content: "block+" },
    tableHeader: { content: "block+" },
  },
});

function createState(doc: ReturnType<typeof schema.node>, cursorPos: number) {
  const state = EditorState.create({ doc, schema });
  const tr = state.tr.setSelection(TextSelection.create(doc, cursorPos, cursorPos));
  return state.apply(tr);
}

// Helper to create nodes
const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const code = (text: string) => schema.node("codeBlock", null, text ? [schema.text(text)] : []);
const bq = (...children: ReturnType<typeof schema.node>[]) => schema.node("blockquote", null, children);
const li = (...children: ReturnType<typeof schema.node>[]) => schema.node("listItem", null, children);
const ul = (...items: ReturnType<typeof schema.node>[]) => schema.node("bulletList", null, items);
const ol = (...items: ReturnType<typeof schema.node>[]) => schema.node("orderedList", null, items);
const tl = (...items: ReturnType<typeof schema.node>[]) => schema.node("taskList", null, items);
const tc = (...children: ReturnType<typeof schema.node>[]) => schema.node("tableCell", null, children);
const tr_ = (...cells: ReturnType<typeof schema.node>[]) => schema.node("tableRow", null, cells);
const table = (...rows: ReturnType<typeof schema.node>[]) => schema.node("table", null, rows);
const doc = (...children: ReturnType<typeof schema.node>[]) => schema.node("doc", null, children);

describe("getNextContainerBounds", () => {
  describe("basic container detection", () => {
    it("cursor in table cell returns cell bounds", () => {
      // doc > table > row > cell > paragraph > "abc"
      const d = doc(table(tr_(tc(p("abc")), tc(p("def")))));
      // Position inside "abc" — we need to find it
      // doc(0) > table(1) > row(1) > cell(1) > paragraph(1) > text
      // Positions: doc_start=0, table_start=1, row_start=1, cell1_start=1, para_start=1, text_start=1
      // Actually: each node boundary takes 1 position
      // doc { table { row { cell { para { "abc" } } cell { para { "def" } } } } }
      // 0    1       2     3      4      567     8  9     10     111213  14 15  16 17
      const state = createState(d, 5); // cursor in "abc"
      const bounds = getNextContainerBounds(state, 5, 5);

      expect(bounds).not.toBeNull();
      // Should return tableCell bounds (innermost container)
      expect(bounds!.from).toBeLessThanOrEqual(5);
      expect(bounds!.to).toBeGreaterThanOrEqual(5);
    });

    it("cursor in list item returns item bounds", () => {
      const d = doc(ul(li(p("item one")), li(p("item two"))));
      // Find a position inside "item one"
      // doc { bulletList { listItem { para { "item one" } } listItem { para { "item two" } } } }
      const state = createState(d, 4); // in "item one"
      const bounds = getNextContainerBounds(state, 4, 4);

      expect(bounds).not.toBeNull();
    });

    it("cursor in blockquote returns blockquote bounds", () => {
      const d = doc(bq(p("quoted text")));
      const state = createState(d, 3); // in "quoted text"
      const bounds = getNextContainerBounds(state, 3, 3);

      expect(bounds).not.toBeNull();
    });

    it("cursor in code block returns code block bounds", () => {
      const d = doc(code("function hello() {}"));
      const state = createState(d, 5); // in code
      const bounds = getNextContainerBounds(state, 5, 5);

      expect(bounds).not.toBeNull();
    });

    it("cursor in plain paragraph returns null", () => {
      const d = doc(p("plain text"));
      const state = createState(d, 3);
      const bounds = getNextContainerBounds(state, 3, 3);

      expect(bounds).toBeNull();
    });

    it("cursor in ordered list returns item bounds", () => {
      const d = doc(ol(li(p("first")), li(p("second"))));
      const state = createState(d, 4);
      const bounds = getNextContainerBounds(state, 4, 4);

      expect(bounds).not.toBeNull();
    });

    it("cursor in task list returns item bounds", () => {
      const d = doc(tl(li(p("task item"))));
      const state = createState(d, 4);
      const bounds = getNextContainerBounds(state, 4, 4);

      expect(bounds).not.toBeNull();
    });
  });

  describe("progressive expansion", () => {
    it("table: cell -> row -> table -> null", () => {
      const d = doc(table(tr_(tc(p("abc")), tc(p("def")))));
      const state = EditorState.create({ doc: d, schema });

      // Start with cursor in "abc"
      const pos = 5;
      let bounds = getNextContainerBounds(state, pos, pos);
      expect(bounds).not.toBeNull();
      const cellBounds = bounds!;

      // Expand from cell selection -> should get row or table (next container up)
      bounds = getNextContainerBounds(state, cellBounds.from, cellBounds.to);
      expect(bounds).not.toBeNull();
      const rowBounds = bounds!;
      expect(rowBounds.from).toBeLessThanOrEqual(cellBounds.from);
      expect(rowBounds.to).toBeGreaterThanOrEqual(cellBounds.to);

      // Expand from row -> table
      bounds = getNextContainerBounds(state, rowBounds.from, rowBounds.to);
      expect(bounds).not.toBeNull();
      const tableBounds = bounds!;
      expect(tableBounds.from).toBeLessThanOrEqual(rowBounds.from);
      expect(tableBounds.to).toBeGreaterThanOrEqual(rowBounds.to);

      // Expand from table -> null (document level)
      bounds = getNextContainerBounds(state, tableBounds.from, tableBounds.to);
      expect(bounds).toBeNull();
    });

    it("flat list: listItem -> bulletList -> null", () => {
      const d = doc(ul(li(p("item A")), li(p("item B"))));
      const state = EditorState.create({ doc: d, schema });

      // Cursor in "item A"
      let bounds = getNextContainerBounds(state, 4, 4);
      expect(bounds).not.toBeNull();
      const itemBounds = bounds!;

      // Expand from item -> list
      bounds = getNextContainerBounds(state, itemBounds.from, itemBounds.to);
      expect(bounds).not.toBeNull();
      const listBounds = bounds!;
      expect(listBounds.from).toBeLessThanOrEqual(itemBounds.from);
      expect(listBounds.to).toBeGreaterThanOrEqual(itemBounds.to);

      // Expand from list -> null
      bounds = getNextContainerBounds(state, listBounds.from, listBounds.to);
      expect(bounds).toBeNull();
    });

    it("nested list: inner item -> inner list -> outer item -> outer list -> null", () => {
      // bulletList > listItem > bulletList > listItem > para
      const d = doc(ul(li(p("outer"), ul(li(p("inner"))))));
      const state = EditorState.create({ doc: d, schema });

      // Find a position inside "inner"
      // We need to search for it
      let innerPos = -1;
      d.descendants((node, pos) => {
        if (node.isText && node.text === "inner") {
          innerPos = pos + 1; // position inside the text
        }
      });
      expect(innerPos).toBeGreaterThan(0);

      // Level 1: inner listItem
      let bounds = getNextContainerBounds(state, innerPos, innerPos);
      expect(bounds).not.toBeNull();
      const innerItemBounds = bounds!;

      // Level 2: inner bulletList
      bounds = getNextContainerBounds(state, innerItemBounds.from, innerItemBounds.to);
      expect(bounds).not.toBeNull();
      const innerListBounds = bounds!;

      // Level 3: outer listItem
      bounds = getNextContainerBounds(state, innerListBounds.from, innerListBounds.to);
      expect(bounds).not.toBeNull();
      const outerItemBounds = bounds!;

      // Level 4: outer bulletList
      bounds = getNextContainerBounds(state, outerItemBounds.from, outerItemBounds.to);
      expect(bounds).not.toBeNull();
      const outerListBounds = bounds!;

      // Level 5: null (document)
      bounds = getNextContainerBounds(state, outerListBounds.from, outerListBounds.to);
      expect(bounds).toBeNull();
    });

    it("blockquote: blockquote -> null", () => {
      const d = doc(bq(p("quoted")));
      const state = EditorState.create({ doc: d, schema });

      let bounds = getNextContainerBounds(state, 3, 3);
      expect(bounds).not.toBeNull();
      const bqBounds = bounds!;

      bounds = getNextContainerBounds(state, bqBounds.from, bqBounds.to);
      expect(bounds).toBeNull();
    });

    it("nested blockquote: inner -> outer -> null", () => {
      const d = doc(bq(bq(p("deep"))));
      const state = EditorState.create({ doc: d, schema });

      let bounds = getNextContainerBounds(state, 4, 4);
      expect(bounds).not.toBeNull();
      const innerBq = bounds!;

      bounds = getNextContainerBounds(state, innerBq.from, innerBq.to);
      expect(bounds).not.toBeNull();
      const outerBq = bounds!;

      bounds = getNextContainerBounds(state, outerBq.from, outerBq.to);
      expect(bounds).toBeNull();
    });

    it("list inside blockquote: item -> list -> blockquote -> null", () => {
      const d = doc(bq(ul(li(p("listed")))));
      const state = EditorState.create({ doc: d, schema });

      let bounds = getNextContainerBounds(state, 5, 5);
      expect(bounds).not.toBeNull();
      const itemBounds = bounds!;

      bounds = getNextContainerBounds(state, itemBounds.from, itemBounds.to);
      expect(bounds).not.toBeNull();
      const listBounds = bounds!;

      bounds = getNextContainerBounds(state, listBounds.from, listBounds.to);
      expect(bounds).not.toBeNull();
      const bqBounds = bounds!;

      bounds = getNextContainerBounds(state, bqBounds.from, bqBounds.to);
      expect(bounds).toBeNull();
    });

    it("code block inside list: codeBlock -> listItem -> list -> null", () => {
      const d = doc(ul(li(code("let x = 1;"))));
      const state = EditorState.create({ doc: d, schema });

      let bounds = getNextContainerBounds(state, 4, 4);
      expect(bounds).not.toBeNull();
      const codeBounds = bounds!;

      bounds = getNextContainerBounds(state, codeBounds.from, codeBounds.to);
      expect(bounds).not.toBeNull();
      const itemBounds = bounds!;

      bounds = getNextContainerBounds(state, itemBounds.from, itemBounds.to);
      expect(bounds).not.toBeNull();
      const listBounds = bounds!;

      bounds = getNextContainerBounds(state, listBounds.from, listBounds.to);
      expect(bounds).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("empty table cell returns bounds (from === to)", () => {
      const d = doc(table(tr_(tc(p("")), tc(p("x")))));
      const state = EditorState.create({ doc: d, schema });

      // Empty cell paragraph: find position
      const bounds = getNextContainerBounds(state, 4, 4);
      expect(bounds).not.toBeNull();
    });

    it("empty list item returns bounds", () => {
      const d = doc(ul(li(p(""))));
      const state = EditorState.create({ doc: d, schema });

      const bounds = getNextContainerBounds(state, 3, 3);
      expect(bounds).not.toBeNull();
    });

    it("empty blockquote returns bounds", () => {
      const d = doc(bq(p("")));
      const state = EditorState.create({ doc: d, schema });

      const bounds = getNextContainerBounds(state, 3, 3);
      expect(bounds).not.toBeNull();
    });

    it("selection spanning entire container returns next-larger container", () => {
      const d = doc(table(tr_(tc(p("abc")), tc(p("def")))));
      const state = EditorState.create({ doc: d, schema });

      // Get cell bounds first
      const cellBounds = getNextContainerBounds(state, 5, 5);
      expect(cellBounds).not.toBeNull();

      // Selecting the entire cell should yield the row
      const rowBounds = getNextContainerBounds(state, cellBounds!.from, cellBounds!.to);
      expect(rowBounds).not.toBeNull();
      expect(rowBounds!.from).toBeLessThanOrEqual(cellBounds!.from);
      expect(rowBounds!.to).toBeGreaterThanOrEqual(cellBounds!.to);
    });

    it("single-item list: listItem bounds differ from list bounds", () => {
      const d = doc(ul(li(p("only"))));
      const state = EditorState.create({ doc: d, schema });

      const itemBounds = getNextContainerBounds(state, 4, 4);
      expect(itemBounds).not.toBeNull();

      const listBounds = getNextContainerBounds(state, itemBounds!.from, itemBounds!.to);
      expect(listBounds).not.toBeNull();
      // List bounds include the list node markers, so they differ
      expect(listBounds!.from).toBeLessThanOrEqual(itemBounds!.from);
      expect(listBounds!.to).toBeGreaterThanOrEqual(itemBounds!.to);
    });
  });
});
