// @vitest-environment node
/**
 * Tests for Table Escape functionality
 *
 * ArrowUp at first row of first-block table → insert paragraph before
 * ArrowDown at last row of last-block table → insert paragraph after
 */

import { describe, it, expect, vi } from "vitest";
import { Schema, type Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { isTableFirstBlock, isTableLastBlock, escapeTableUp, escapeTableDown } from "./tableEscape";

// ---------- schema ----------

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline", inline: true },
    table: {
      group: "block",
      content: "tableRow+",
      tableRole: "table",
    },
    tableRow: {
      content: "(tableCell | tableHeader)+",
      tableRole: "row",
    },
    tableCell: {
      content: "block+",
      attrs: { alignment: { default: null } },
      tableRole: "cell",
    },
    tableHeader: {
      content: "block+",
      attrs: { alignment: { default: null } },
      tableRole: "header_cell",
    },
  },
});

// ---------- helpers ----------

function headerCell(text = ""): Node {
  const content = text
    ? [schema.nodes.paragraph.create(null, [schema.text(text)])]
    : [schema.nodes.paragraph.create()];
  return schema.nodes.tableHeader.create(null, content);
}

function cell(text = ""): Node {
  const content = text
    ? [schema.nodes.paragraph.create(null, [schema.text(text)])]
    : [schema.nodes.paragraph.create()];
  return schema.nodes.tableCell.create(null, content);
}

function row(cells: Node[]): Node {
  return schema.nodes.tableRow.create(null, cells);
}

function table(rows: Node[]): Node {
  return schema.nodes.table.create(null, rows);
}

function createTableDoc(opts: { prefix?: boolean; suffix?: boolean; numRows?: number; numCols?: number }) {
  const { prefix = false, suffix = false, numRows = 2, numCols = 2 } = opts;
  const rows: Node[] = [];
  for (let r = 0; r < numRows; r++) {
    const cells: Node[] = [];
    for (let c = 0; c < numCols; c++) {
      cells.push(r === 0 ? headerCell(`h${c}`) : cell(`r${r}c${c}`));
    }
    rows.push(row(cells));
  }

  const blocks: Node[] = [];
  if (prefix) blocks.push(schema.nodes.paragraph.create(null, [schema.text("before")]));
  blocks.push(table(rows));
  if (suffix) blocks.push(schema.nodes.paragraph.create(null, [schema.text("after")]));

  return schema.nodes.doc.create(null, blocks);
}

function stateWithCursorInTable(
  doc: Node,
  rowIndex: number,
  colIndex: number,
  tableIndex = 0,
): EditorState {
  const state = EditorState.create({ doc, schema });

  // Find the table position
  let tableCount = 0;
  let tablePos = -1;
  doc.forEach((node, offset) => {
    if (node.type.name === "table") {
      if (tableCount === tableIndex) {
        tablePos = offset;
      }
      tableCount++;
    }
  });

  if (tablePos < 0) throw new Error("Table not found");
  const tableNode = doc.nodeAt(tablePos)!;

  // Navigate to cell
  let pos = tablePos + 1; // inside table
  for (let r = 0; r < rowIndex; r++) {
    pos += tableNode.child(r).nodeSize;
  }
  pos += 1; // inside row
  for (let c = 0; c < colIndex; c++) {
    pos += tableNode.child(rowIndex).child(c).nodeSize;
  }
  pos += 2; // inside cell -> inside paragraph

  const $pos = state.doc.resolve(pos);
  return state.apply(state.tr.setSelection(TextSelection.near($pos)));
}

function mockView(state: EditorState): EditorView {
  const view = {
    state,
    dispatch: vi.fn((tr) => {
      (view as { state: EditorState }).state = state.apply(tr);
    }),
    focus: vi.fn(),
  } as unknown as EditorView;
  return view;
}

// ---------- pure function tests ----------

describe("isTableFirstBlock", () => {
  it("returns true when tablePos is 0", () => {
    expect(isTableFirstBlock(0)).toBe(true);
  });

  it("returns false when tablePos is greater than 0", () => {
    expect(isTableFirstBlock(10)).toBe(false);
    expect(isTableFirstBlock(1)).toBe(false);
  });
});

describe("isTableLastBlock", () => {
  it("returns true when table ends at document end", () => {
    expect(isTableLastBlock(0, 50, 50)).toBe(true);
  });

  it("returns false when there is content after table", () => {
    expect(isTableLastBlock(0, 50, 100)).toBe(false);
  });

  it("handles table not at start", () => {
    expect(isTableLastBlock(20, 30, 50)).toBe(true);
    expect(isTableLastBlock(20, 30, 60)).toBe(false);
  });
});

// ---------- escapeTableUp integration tests ----------

describe("escapeTableUp", () => {
  it("inserts paragraph before table when cursor is in first row of first block", () => {
    const doc = createTableDoc({ prefix: false, suffix: true });
    const state = stateWithCursorInTable(doc, 0, 0);
    const view = mockView(state);

    const result = escapeTableUp(view);
    expect(result).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    // Verify: first node in new doc should be a paragraph
    const newDoc = view.state.doc;
    expect(newDoc.child(0).type.name).toBe("paragraph");
  });

  it("returns false when cursor is not in first row", () => {
    const doc = createTableDoc({ prefix: false, suffix: true, numRows: 3 });
    const state = stateWithCursorInTable(doc, 1, 0);
    const view = mockView(state);

    expect(escapeTableUp(view)).toBe(false);
  });

  it("returns false when table is not first block", () => {
    const doc = createTableDoc({ prefix: true });
    const state = stateWithCursorInTable(doc, 0, 0);
    const view = mockView(state);

    expect(escapeTableUp(view)).toBe(false);
  });

  it("returns false when not in a table", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema });
    const view = mockView(state);

    expect(escapeTableUp(view)).toBe(false);
  });
});

// ---------- escapeTableDown integration tests ----------

describe("escapeTableDown", () => {
  it("inserts paragraph after table when cursor is in last row of last block", () => {
    const doc = createTableDoc({ prefix: true, suffix: false, numRows: 2 });
    const state = stateWithCursorInTable(doc, 1, 0);
    const view = mockView(state);

    const result = escapeTableDown(view);
    expect(result).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    // Verify: last node should be a paragraph
    const newDoc = view.state.doc;
    expect(newDoc.lastChild!.type.name).toBe("paragraph");
  });

  it("returns false when cursor is not in last row", () => {
    const doc = createTableDoc({ prefix: true, suffix: false, numRows: 3 });
    const state = stateWithCursorInTable(doc, 1, 0); // middle row
    const view = mockView(state);

    expect(escapeTableDown(view)).toBe(false);
  });

  it("returns false when table is not last block", () => {
    const doc = createTableDoc({ suffix: true });
    const state = stateWithCursorInTable(doc, 1, 0);
    const view = mockView(state);

    expect(escapeTableDown(view)).toBe(false);
  });

  it("returns false when not in a table", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema });
    const view = mockView(state);

    expect(escapeTableDown(view)).toBe(false);
  });

  it("handles table as only content in document", () => {
    const doc = createTableDoc({ prefix: false, suffix: false, numRows: 2 });
    const state = stateWithCursorInTable(doc, 1, 0);
    const view = mockView(state);

    const result = escapeTableDown(view);
    expect(result).toBe(true);
  });
});

describe("escapeTableUp — schema without paragraph (line 48)", () => {
  const noParagraphSchema = new Schema({
    nodes: {
      doc: { content: "table+" },
      table: {
        content: "tableRow+",
        tableRole: "table",
      },
      tableRow: {
        content: "tableCell+",
        tableRole: "row",
      },
      tableCell: {
        content: "text*",
        attrs: { alignment: { default: null } },
        tableRole: "cell",
      },
      text: { inline: true },
    },
  });

  it("returns false when schema lacks paragraph type", () => {
    const cellNode = noParagraphSchema.nodes.tableCell.create(null, [noParagraphSchema.text("hi")]);
    const rowNode = noParagraphSchema.nodes.tableRow.create(null, [cellNode]);
    const tableNode = noParagraphSchema.nodes.table.create(null, [rowNode]);
    const doc = noParagraphSchema.nodes.doc.create(null, [tableNode]);
    // Cursor inside cell text: doc(0) > table(+1) > row(+1) > cell(+1) = pos 3
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });
    const view = mockView(state);
    // getTableInfo should find the table; cursor is in first row of first block
    // But paragraphType is undefined → returns false (line 48)
    expect(escapeTableUp(view)).toBe(false);
  });
});

describe("escapeTableDown — schema without paragraph (line 77)", () => {
  const noParagraphSchema = new Schema({
    nodes: {
      doc: { content: "table+" },
      table: {
        content: "tableRow+",
        tableRole: "table",
      },
      tableRow: {
        content: "tableCell+",
        tableRole: "row",
      },
      tableCell: {
        content: "text*",
        attrs: { alignment: { default: null } },
        tableRole: "cell",
      },
      text: { inline: true },
    },
  });

  it("returns false when schema lacks paragraph type", () => {
    const cellNode = noParagraphSchema.nodes.tableCell.create(null, [noParagraphSchema.text("hi")]);
    const rowNode = noParagraphSchema.nodes.tableRow.create(null, [cellNode]);
    const tableNode = noParagraphSchema.nodes.table.create(null, [rowNode]);
    const doc = noParagraphSchema.nodes.doc.create(null, [tableNode]);
    // Cursor inside cell: pos 3
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });
    const view = mockView(state);
    // getTableInfo finds table; cursor in last row of last block
    // But paragraphType is undefined → returns false (line 77)
    expect(escapeTableDown(view)).toBe(false);
  });
});
