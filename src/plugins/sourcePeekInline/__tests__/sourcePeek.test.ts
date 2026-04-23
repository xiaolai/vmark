/**
 * Source Peek Tests
 *
 * Tests for getExpandedSourcePeekRange, and store behavior.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Schema, DOMParser } from "@tiptap/pm/model";
import { getExpandedSourcePeekRange } from "@/utils/sourcePeek";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { canUseSourcePeek } from "../tiptap";

// Create a test schema with tables, lists, and blockquotes
const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM() { return ["p", 0]; },
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
      ],
      toDOM(node) { return [`h${node.attrs.level}`, 0]; },
    },
    bulletList: {
      content: "listItem+",
      group: "block",
      parseDOM: [{ tag: "ul" }],
      toDOM() { return ["ul", 0]; },
    },
    orderedList: {
      content: "listItem+",
      group: "block",
      parseDOM: [{ tag: "ol" }],
      toDOM() { return ["ol", 0]; },
    },
    listItem: {
      content: "paragraph block*",
      parseDOM: [{ tag: "li" }],
      toDOM() { return ["li", 0]; },
    },
    table: {
      content: "tableRow+",
      group: "block",
      parseDOM: [{ tag: "table" }],
      toDOM() { return ["table", ["tbody", 0]]; },
    },
    tableRow: {
      content: "tableCell+",
      parseDOM: [{ tag: "tr" }],
      toDOM() { return ["tr", 0]; },
    },
    tableCell: {
      content: "inline*",
      parseDOM: [{ tag: "td" }],
      toDOM() { return ["td", 0]; },
    },
    blockquote: {
      content: "block+",
      group: "block",
      parseDOM: [{ tag: "blockquote" }],
      toDOM() { return ["blockquote", 0]; },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      code: true,
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM() { return ["pre", ["code", 0]]; },
    },
    text: { group: "inline" },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }],
      toDOM() { return ["strong", 0]; },
    },
    em: {
      parseDOM: [{ tag: "em" }],
      toDOM() { return ["em", 0]; },
    },
  },
});

function createState(html: string, cursorPos?: number): EditorState {
  const container = document.createElement("div");
  container.innerHTML = html;
  const doc = DOMParser.fromSchema(testSchema).parse(container);
  const state = EditorState.create({ doc, schema: testSchema });

  if (cursorPos !== undefined) {
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, cursorPos))
    );
  }
  return state;
}

describe("getExpandedSourcePeekRange", () => {
  it("expands to include entire table when cursor inside cell", () => {
    const state = createState(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
      4 // Inside first cell
    );
    const range = getExpandedSourcePeekRange(state);

    // Should include entire table
    expect(range.from).toBe(0);
    expect(range.to).toBe(state.doc.content.size);
  });

  it("expands to include entire list when cursor inside item", () => {
    const state = createState(
      "<ul><li><p>First</p></li><li><p>Second</p></li></ul>",
      4 // Inside first list item
    );
    const range = getExpandedSourcePeekRange(state);

    // Should include entire bulletList
    expect(range.from).toBe(0);
    expect(range.to).toBe(state.doc.content.size);
  });

  it("expands to include entire blockquote when cursor inside", () => {
    const state = createState(
      "<blockquote><p>Quote text</p></blockquote><p>Regular text</p>",
      5 // Inside blockquote paragraph
    );
    const range = getExpandedSourcePeekRange(state);

    // Should include blockquote but not the following paragraph
    expect(range.from).toBe(0);
    expect(range.to).toBeLessThan(state.doc.content.size);
  });

  it("returns paragraph range when not inside compound block", () => {
    const state = createState("<p>Simple paragraph</p>", 5);
    const range = getExpandedSourcePeekRange(state);

    expect(range.from).toBe(0);
    expect(range.to).toBe(state.doc.content.size);
  });

  it("handles nested structures correctly", () => {
    // Blockquote containing a list
    const state = createState(
      "<blockquote><ul><li><p>Item in quote</p></li></ul></blockquote>",
      8 // Inside list item paragraph
    );
    const range = getExpandedSourcePeekRange(state);

    // Should expand to blockquote (first compound block encountered)
    expect(range.from).toBe(0);
    expect(range.to).toBe(state.doc.content.size);
  });
});

describe("useSourcePeekStore", () => {
  beforeEach(() => {
    useSourcePeekStore.setState({
      isOpen: false,
      editingPos: null,
      range: null,
      anchorRect: null,
      markdown: "",
      originalMarkdown: null,
      livePreview: false,
      parseError: null,
      hasUnsavedChanges: false,
      blockTypeName: null,
    });
  });

  it("opens with correct initial state", () => {
    const store = useSourcePeekStore.getState();

    store.open({
      markdown: "# Hello\n\nWorld",
      range: { from: 0, to: 10 },
      blockTypeName: "heading",
    });

    const state = useSourcePeekStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.markdown).toBe("# Hello\n\nWorld");
    expect(state.originalMarkdown).toBe("# Hello\n\nWorld");
    expect(state.range).toEqual({ from: 0, to: 10 });
    expect(state.blockTypeName).toBe("heading");
    expect(state.hasUnsavedChanges).toBe(false);
  });

  it("tracks unsaved changes correctly", () => {
    const store = useSourcePeekStore.getState();

    store.open({
      markdown: "Original",
      range: { from: 0, to: 10 },
    });

    expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(false);

    store.setMarkdown("Modified");
    expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(true);

    store.setMarkdown("Original");
    expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("closes and resets state", () => {
    const store = useSourcePeekStore.getState();

    store.open({
      markdown: "Content",
      range: { from: 0, to: 10 },
    });

    store.setMarkdown("Modified");
    store.close();

    const state = useSourcePeekStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.markdown).toBe("");
    expect(state.originalMarkdown).toBe(null);
    expect(state.hasUnsavedChanges).toBe(false);
  });

  it("toggles live preview", () => {
    const store = useSourcePeekStore.getState();

    store.open({
      markdown: "Content",
      range: { from: 0, to: 10 },
    });

    expect(useSourcePeekStore.getState().livePreview).toBe(false);

    store.toggleLivePreview();
    expect(useSourcePeekStore.getState().livePreview).toBe(true);

    store.toggleLivePreview();
    expect(useSourcePeekStore.getState().livePreview).toBe(false);
  });

  it("preserves original markdown for revert", () => {
    const store = useSourcePeekStore.getState();

    store.open({
      markdown: "Original content",
      range: { from: 0, to: 10 },
    });

    store.setMarkdown("New content");
    store.setMarkdown("Another edit");

    // Original should still be preserved
    expect(store.getOriginalMarkdown()).toBe("Original content");
  });

  it("clears parse error when content changes", () => {
    const store = useSourcePeekStore.getState();

    store.open({
      markdown: "Content",
      range: { from: 0, to: 10 },
    });

    store.setParseError("Invalid markdown");
    expect(useSourcePeekStore.getState().parseError).toBe("Invalid markdown");

    store.setMarkdown("Fixed content");
    expect(useSourcePeekStore.getState().parseError).toBe(null);
  });
});

describe("canUseSourcePeek", () => {
  it("returns true for paragraph", () => {
    expect(canUseSourcePeek("paragraph")).toBe(true);
  });

  it("returns true for heading", () => {
    expect(canUseSourcePeek("heading")).toBe(true);
  });

  it("returns true for blockquote", () => {
    expect(canUseSourcePeek("blockquote")).toBe(true);
  });

  it("returns true for bulletList", () => {
    expect(canUseSourcePeek("bulletList")).toBe(true);
  });

  it("returns true for orderedList", () => {
    expect(canUseSourcePeek("orderedList")).toBe(true);
  });

  it("returns true for table", () => {
    expect(canUseSourcePeek("table")).toBe(true);
  });

  it("returns false for codeBlock", () => {
    expect(canUseSourcePeek("codeBlock")).toBe(false);
  });

  it("returns false for code_block", () => {
    expect(canUseSourcePeek("code_block")).toBe(false);
  });

  it("returns false for block_image", () => {
    expect(canUseSourcePeek("block_image")).toBe(false);
  });

  it("returns false for frontmatter", () => {
    expect(canUseSourcePeek("frontmatter")).toBe(false);
  });

  it("returns false for html_block", () => {
    expect(canUseSourcePeek("html_block")).toBe(false);
  });

  it("returns false for horizontalRule", () => {
    expect(canUseSourcePeek("horizontalRule")).toBe(false);
  });
});
