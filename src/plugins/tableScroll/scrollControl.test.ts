import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isSelectionInTable, scrollEditorToSelection } from "./scrollControl";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Minimal schema with table nodes
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    table: { content: "table_row+", group: "block", attrs: { sourceLine: { default: null } } },
    table_row: { content: "table_cell+" },
    table_cell: { content: "paragraph+", attrs: { colspan: { default: 1 }, rowspan: { default: 1 } } },
    text: { inline: true },
  },
});

function createDocWithTable() {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("before table")]),
    schema.node("table", null, [
      schema.node("table_row", null, [
        schema.node("table_cell", null, [
          schema.node("paragraph", null, [schema.text("cell A")]),
        ]),
        schema.node("table_cell", null, [
          schema.node("paragraph", null, [schema.text("cell B")]),
        ]),
      ]),
    ]),
    schema.node("paragraph", null, [schema.text("after table")]),
  ]);
}

function createDocWithoutTable() {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("hello world")]),
    schema.node("paragraph", null, [schema.text("second paragraph")]),
  ]);
}

function createState(doc: ReturnType<typeof schema.node>, pos: number): EditorState {
  const state = EditorState.create({ doc, schema });
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos))
  );
}

function mockView(state: EditorState, overrides: Partial<EditorView> = {}): EditorView {
  return {
    state,
    dom: document.createElement("div"),
    ...overrides,
  } as unknown as EditorView;
}

describe("isSelectionInTable", () => {
  it("returns true when cursor is inside a table cell", () => {
    const doc = createDocWithTable();
    // Position inside first table cell paragraph: doc(1) -> paragraph(+1) -> table(+1) -> row(+1) -> cell(+1) -> paragraph(+1)
    // "before table" is 12 chars, paragraph node size = 14 (12 + 2 boundary), so table starts at pos 15
    // table(+1) -> row(+1) -> cell(+1) -> paragraph(+1) = 15+1+1+1+1 = 19
    // Let's find the pos by walking the doc
    let cellTextPos = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === "cell A" && cellTextPos === -1) {
        cellTextPos = pos;
      }
    });
    expect(cellTextPos).toBeGreaterThan(0);
    const state = createState(doc, cellTextPos);
    const view = mockView(state);
    expect(isSelectionInTable(view)).toBe(true);
  });

  it("returns false when cursor is in a regular paragraph", () => {
    const doc = createDocWithTable();
    // Position 1 is inside the first paragraph
    const state = createState(doc, 1);
    const view = mockView(state);
    expect(isSelectionInTable(view)).toBe(false);
  });

  it("returns false when document has no tables", () => {
    const doc = createDocWithoutTable();
    const state = createState(doc, 1);
    const view = mockView(state);
    expect(isSelectionInTable(view)).toBe(false);
  });
});

describe("scrollEditorToSelection", () => {
  let container: HTMLElement;
  let editorDom: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.className = "editor-content";
    editorDom = document.createElement("div");
    container.appendChild(editorDom);
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  /** Set up container bounding rect and a writable scrollTop. Returns a getter for scrollTop. */
  function mockContainer(
    rect: { top: number; bottom: number },
    initialScrollTop: number,
  ): { getScrollTop: () => number } {
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ top: rect.top, bottom: rect.bottom, left: 0, right: 800, width: 800, height: rect.bottom - rect.top }),
      configurable: true,
    });
    let scrollTopValue = initialScrollTop;
    Object.defineProperty(container, "scrollTop", {
      get: () => scrollTopValue,
      set: (v: number) => { scrollTopValue = v; },
      configurable: true,
    });
    return { getScrollTop: () => scrollTopValue };
  }

  it("returns true even when .editor-content is not found", () => {
    const doc = createDocWithoutTable();
    const state = createState(doc, 1);
    // View with dom that has no .editor-content ancestor
    const orphanDom = document.createElement("div");
    const view = mockView(state, {
      dom: orphanDom,
      coordsAtPos: () => ({ top: 50, bottom: 70, left: 0, right: 0 }),
    });
    // Always returns true to suppress ProseMirror's default scroll
    expect(scrollEditorToSelection(view)).toBe(true);
  });

  it("returns true and scrolls down when cursor is below viewport", () => {
    const doc = createDocWithoutTable();
    const state = createState(doc, 1);
    const { getScrollTop } = mockContainer({ top: 0, bottom: 400 }, 0);

    const view = mockView(state, {
      dom: editorDom,
      coordsAtPos: () => ({ top: 450, bottom: 470, left: 0, right: 0 }),
    });

    const result = scrollEditorToSelection(view);
    expect(result).toBe(true);
    // Cursor bottom (470) > container bottom (400) - margin (20) = 380
    // scrollTop should increase by 470 - 400 + 20 = 90
    expect(getScrollTop()).toBe(90);
  });

  it("returns true and scrolls up when cursor is above viewport", () => {
    const doc = createDocWithoutTable();
    const state = createState(doc, 1);
    const { getScrollTop } = mockContainer({ top: 100, bottom: 500 }, 200);

    const view = mockView(state, {
      dom: editorDom,
      coordsAtPos: () => ({ top: 50, bottom: 70, left: 0, right: 0 }),
    });

    const result = scrollEditorToSelection(view);
    expect(result).toBe(true);
    // Cursor top (50) < container top (100) + margin (20) = 120
    // scrollTop should decrease by 120 - 50 = 70
    expect(getScrollTop()).toBe(200 - 70);
  });

  it("does not scroll when cursor is already visible", () => {
    const doc = createDocWithoutTable();
    const state = createState(doc, 1);
    const { getScrollTop } = mockContainer({ top: 0, bottom: 400 }, 100);

    const view = mockView(state, {
      dom: editorDom,
      coordsAtPos: () => ({ top: 200, bottom: 220, left: 0, right: 0 }),
    });

    const result = scrollEditorToSelection(view);
    expect(result).toBe(true);
    // Cursor is well within bounds, scrollTop should not change
    expect(getScrollTop()).toBe(100);
  });

  it("returns true even when coordsAtPos throws", () => {
    const doc = createDocWithoutTable();
    const state = createState(doc, 1);

    const view = mockView(state, {
      dom: editorDom,
      coordsAtPos: () => { throw new Error("Invalid pos"); },
    });

    // Always returns true to suppress ProseMirror's default scroll
    expect(scrollEditorToSelection(view)).toBe(true);
  });
});
