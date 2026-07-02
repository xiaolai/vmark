import { describe, it, expect } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { TableWithScrollWrapper } from "./plugin";
import { manifest } from "./manifest";

/**
 * Walk the Tiptap extension `.parent` chain to find a config field.
 * TableWithScrollWrapper is Table.extend({renderHTML, addNodeView})
 * further extended by withSourceLine, so renderHTML/addNodeView live
 * on an ancestor's config, not the outermost one.
 */
interface ExtensionLike {
  config: Record<string, unknown>;
  parent?: ExtensionLike | null;
}

function getConfigField<T>(extension: unknown, field: string): T {
  let current = extension as ExtensionLike | null | undefined;
  while (current) {
    const value = current.config?.[field];
    if (value !== undefined) return value as T;
    current = current.parent;
  }
  throw new Error(`Config field "${field}" not found in extension chain`);
}

/** Minimal PMNode stand-in — NodeView only reads `node.type`. */
function createMockNode(typeName = "table"): PMNode {
  return { type: { name: typeName } } as unknown as PMNode;
}

type NodeViewFactory = (props: { node: PMNode }) => NodeView & {
  dom: HTMLDivElement;
  contentDOM: HTMLTableSectionElement;
};

function createNodeView(node: PMNode = createMockNode()) {
  const addNodeView = getConfigField<(this: unknown) => NodeViewFactory>(
    TableWithScrollWrapper,
    "addNodeView"
  );
  const factory = addNodeView.call({});
  return factory({ node });
}

/** Build a ViewMutationRecord-shaped object from a partial. */
function mutation(partial: {
  type: "attributes" | "childList" | "characterData" | "selection";
  target: Node;
  addedNodes?: Node[];
  removedNodes?: Node[];
}): ViewMutationRecord {
  return {
    addedNodes: [],
    removedNodes: [],
    ...partial,
  } as unknown as ViewMutationRecord;
}

describe("TableWithScrollWrapper renderHTML", () => {
  it("wraps table in a div.table-scroll-wrapper with tbody content hole", () => {
    const renderHTML = getConfigField<
      (this: unknown, props: { HTMLAttributes: Record<string, unknown> }) => unknown
    >(TableWithScrollWrapper, "renderHTML");

    const attrs = { class: "my-table", "data-x": "1" };
    const result = renderHTML.call({}, { HTMLAttributes: attrs });

    expect(result).toEqual([
      "div",
      { class: "table-scroll-wrapper" },
      ["table", attrs, ["tbody", 0]],
    ]);
  });
});

describe("TableScrollNodeView construction", () => {
  it("builds div.table-scroll-wrapper > table > tbody with tbody as contentDOM", () => {
    const view = createNodeView();

    expect(view.dom.tagName).toBe("DIV");
    expect(view.dom.className).toBe("table-scroll-wrapper");

    const table = view.dom.firstElementChild;
    expect(table?.tagName).toBe("TABLE");
    expect(view.contentDOM.tagName).toBe("TBODY");
    expect(view.contentDOM.parentElement).toBe(table);
  });
});

describe("TableScrollNodeView update", () => {
  it("accepts a node of the same type and swaps the stored node", () => {
    const node = createMockNode();
    const view = createNodeView(node);
    // Same type object (reference equality is what PM checks)
    const nextNode = { type: node.type } as unknown as PMNode;

    expect(view.update?.(nextNode)).toBe(true);
    // Subsequent update with the swapped node's type still succeeds
    expect(view.update?.({ type: nextNode.type } as unknown as PMNode)).toBe(true);
  });

  it("rejects a node of a different type", () => {
    const view = createNodeView(createMockNode("table"));
    const otherNode = createMockNode("paragraph");

    expect(view.update?.(otherNode)).toBe(false);
    // Node was NOT swapped: a node matching the original type still updates
    expect(view.update?.({ type: (view as unknown as { node: PMNode }).node.type } as unknown as PMNode)).toBe(true);
  });
});

describe("TableScrollNodeView ignoreMutation", () => {
  function setup() {
    const view = createNodeView();
    // Simulate real content: a row cell inside the tbody
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    row.appendChild(cell);
    view.contentDOM.appendChild(row);
    return { view, cell };
  }

  it("ignores attribute mutations on the wrapper div", () => {
    const { view } = setup();
    expect(view.ignoreMutation?.(mutation({ type: "attributes", target: view.dom }))).toBe(true);
  });

  it("ignores attribute mutations on the table element", () => {
    const { view } = setup();
    const table = view.dom.firstElementChild as HTMLTableElement;
    expect(view.ignoreMutation?.(mutation({ type: "attributes", target: table }))).toBe(true);
  });

  it("ignores mutations on elements outside contentDOM", () => {
    const { view } = setup();
    const detached = document.createElement("div");
    expect(view.ignoreMutation?.(mutation({ type: "childList", target: detached }))).toBe(true);
  });

  it("ignores childList mutations on the wrapper div itself (outside contentDOM)", () => {
    const { view } = setup();
    expect(view.ignoreMutation?.(mutation({ type: "childList", target: view.dom }))).toBe(true);
  });

  it("ignores mutations targeting a resize handle inside a cell", () => {
    const { view, cell } = setup();
    const handle = document.createElement("div");
    handle.className = "table-resize-handle";
    cell.appendChild(handle);

    expect(view.ignoreMutation?.(mutation({ type: "attributes", target: handle }))).toBe(true);
  });

  it("ignores childList mutations adding a resize handle", () => {
    const { view, cell } = setup();
    const handle = document.createElement("div");
    handle.className = "table-resize-handle";

    expect(
      view.ignoreMutation?.(
        mutation({ type: "childList", target: cell, addedNodes: [handle] })
      )
    ).toBe(true);
  });

  it("ignores childList mutations removing a resize handle", () => {
    const { view, cell } = setup();
    const handle = document.createElement("div");
    handle.className = "table-resize-handle";

    expect(
      view.ignoreMutation?.(
        mutation({ type: "childList", target: cell, removedNodes: [handle] })
      )
    ).toBe(true);
  });

  it("does NOT ignore ordinary childList content mutations in a cell", () => {
    const { view, cell } = setup();
    const paragraph = document.createElement("p");

    expect(
      view.ignoreMutation?.(
        mutation({ type: "childList", target: cell, addedNodes: [paragraph] })
      )
    ).toBe(false);
  });

  it("does NOT ignore childList mutations with empty added/removed lists", () => {
    const { view, cell } = setup();
    expect(view.ignoreMutation?.(mutation({ type: "childList", target: cell }))).toBe(false);
  });

  it("does NOT ignore attribute mutations on ordinary cell content", () => {
    const { view, cell } = setup();
    expect(view.ignoreMutation?.(mutation({ type: "attributes", target: cell }))).toBe(false);
  });

  it("does NOT ignore characterData mutations on text nodes (no classList crash)", () => {
    const { view, cell } = setup();
    const text = document.createTextNode("hello");
    cell.appendChild(text);

    // Text nodes have no classList — optional chaining must handle this
    expect(view.ignoreMutation?.(mutation({ type: "characterData", target: text }))).toBe(false);
  });
});

describe("tableScroll manifest", () => {
  it("registers as a markdown wysiwyg plugin", () => {
    expect(manifest).toEqual({
      id: "tableScroll",
      formats: ["markdown"],
      modes: ["wysiwyg"],
    });
  });
});
