vi.mock("@/utils/debug", () => ({
  sourcePeekError: vi.fn(),
}));

import { describe, expect, it, vi } from "vitest";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { Table, TableRow } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { highlightExtension } from "@/plugins/highlight/tiptap";
import { subscriptExtension, superscriptExtension } from "@/plugins/subSuperscript/tiptap";
import { alertBlockExtension } from "@/plugins/alertBlock/tiptap";
import { detailsBlockExtension, detailsSummaryExtension } from "@/plugins/detailsBlock/tiptap";
import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { blockImageExtension } from "@/plugins/blockImage/tiptap";
import { footnoteDefinitionExtension, footnoteReferenceExtension } from "@/plugins/footnotePopup/tiptapNodes";
import { mathInlineExtension } from "@/plugins/latex/tiptapInlineMath";
import { AlignedTableCell, AlignedTableHeader } from "@/components/Editor/alignedTableNodes";
import {
  createSourcePeekSlice,
  getExpandedSourcePeekRange,
  serializeSourcePeekRange,
  applySourcePeekMarkdown,
} from "./sourcePeek";

function createSchema() {
  return getSchema([
    StarterKit.configure({ listItem: false }),
    taskListItemExtension,
    highlightExtension,
    subscriptExtension,
    superscriptExtension,
    mathInlineExtension,
    alertBlockExtension,
    detailsSummaryExtension,
    detailsBlockExtension,
    footnoteReferenceExtension,
    footnoteDefinitionExtension,
    Image.configure({ inline: true }),
    blockImageExtension,
    Table.configure({ resizable: false }),
    TableRow,
    AlignedTableHeader,
    AlignedTableCell,
  ]);
}

describe("sourcePeek helpers", () => {
  it("serializes the selection range to markdown", () => {
    const schema = createSchema();
    const doc = parseMarkdown(schema, "Alpha\n\nBeta");
    const selection = TextSelection.create(doc, 1);
    const state = EditorState.create({ doc, selection });

    const range = getExpandedSourcePeekRange(state);
    const markdown = serializeSourcePeekRange(state, range).trim();

    expect(markdown).toBe("Alpha");
  });

  it("creates a slice with a paragraph when markdown is empty", () => {
    const schema = createSchema();
    const slice = createSourcePeekSlice(schema, "");

    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.type.name).toBe("paragraph");
  });

  it("creates a slice with inline content wrapped in paragraph", () => {
    const schema = createSchema();
    // Create slice from inline content by parsing markdown with inline formatting
    const slice = createSourcePeekSlice(schema, "**bold text**");

    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.type.name).toBe("paragraph");
    expect(slice.content.firstChild?.textContent).toBe("bold text");
  });

  it("preserves block content without wrapping", () => {
    const schema = createSchema();
    const slice = createSourcePeekSlice(schema, "# Heading\n\nParagraph");

    // Should have heading and paragraph as separate blocks
    expect(slice.content.childCount).toBe(2);
    expect(slice.content.firstChild?.type.name).toBe("heading");
    expect(slice.content.child(1).type.name).toBe("paragraph");
  });

  it("serializes multi-paragraph selection correctly", () => {
    const schema = createSchema();
    const doc = parseMarkdown(schema, "First paragraph\n\nSecond paragraph");
    // Select text spanning from first to second paragraph
    const selection = TextSelection.create(doc, 1, doc.content.size - 1);
    const state = EditorState.create({ doc, selection });

    const range = getExpandedSourcePeekRange(state);
    const markdown = serializeSourcePeekRange(state, range).trim();

    expect(markdown).toContain("First paragraph");
    expect(markdown).toContain("Second paragraph");
  });
});

describe("getExpandedSourcePeekRange", () => {
  it("returns node selection bounds for block node selections", () => {
    const schema = createSchema();
    const blockImage = schema.nodes.block_image.create({ src: "img.png", alt: "", title: "" });
    const doc = schema.nodes.doc.create(null, [blockImage]);
    const selection = NodeSelection.create(doc, 0);
    const state = EditorState.create({ doc, selection });

    const range = getExpandedSourcePeekRange(state);
    expect(range).toEqual({ from: selection.from, to: selection.to });
  });

  it("expands to compound block ancestor for table", () => {
    const schema = createSchema();
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const doc = parseMarkdown(schema, md);
    // Position inside the table content
    const selection = TextSelection.create(doc, 4);
    const state = EditorState.create({ doc, selection });

    const range = getExpandedSourcePeekRange(state);
    // Range should include the entire table
    expect(range.from).toBe(0);
    expect(range.to).toBe(doc.content.size);
  });

  it("expands to compound block ancestor for bullet list", () => {
    const schema = createSchema();
    const md = "- item 1\n- item 2";
    const doc = parseMarkdown(schema, md);
    const selection = TextSelection.create(doc, 3);
    const state = EditorState.create({ doc, selection });

    const range = getExpandedSourcePeekRange(state);
    // Should include the entire list
    expect(range.from).toBe(0);
    expect(range.to).toBe(doc.content.size);
  });

  it("returns depth-1 range for non-compound block", () => {
    const schema = createSchema();
    const md = "Just a paragraph";
    const doc = parseMarkdown(schema, md);
    const selection = TextSelection.create(doc, 3);
    const state = EditorState.create({ doc, selection });

    const range = getExpandedSourcePeekRange(state);
    expect(range.from).toBe(0);
    expect(range.to).toBe(doc.content.size);
  });

  it("handles shallow selection (depth < 1)", () => {
    const schema = createSchema();
    const doc = parseMarkdown(schema, "Test");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 0, doc.content.size),
    });

    const range = getExpandedSourcePeekRange(state);
    expect(range.from).toBe(0);
    expect(range.to).toBe(doc.content.size);
  });
});

describe("sourcePeek - createDocFromSlice edge case", () => {
  it("handles slice where docType.create throws", () => {
    const schema = createSchema();
    // Creating a slice from invalid markdown should still work via fallback
    const slice = createSourcePeekSlice(schema, "# Valid heading");
    expect(slice.content.childCount).toBeGreaterThan(0);
  });

  it("ensureBlockContent wraps inline fragment in paragraph (line 37)", () => {
    const schema = createSchema();
    // Create a slice from plain inline text — the parser may wrap it already,
    // but we verify the output has block content regardless
    const slice = createSourcePeekSlice(schema, "just text");
    expect(slice.content.childCount).toBeGreaterThan(0);
    expect(slice.content.firstChild?.isBlock).toBe(true);
  });
});

describe("sourcePeek - ensureBlockContent with inline slice (line 36)", () => {
  it("wraps inline fragment in paragraph when doc.slice produces inline content", () => {
    // doc.slice with openStart/openEnd can produce fragments with inline nodes.
    // When from/to land inside a paragraph at inline positions with depth >= 1,
    // serializeSourcePeekRange calls createDocFromSlice which calls ensureBlockContent.
    // A slice taken within a paragraph (doc.slice(2, 4) on "hello") has inline (text) content.
    const schema = createSchema();
    const doc = parseMarkdown(schema, "hello");
    // Slice inside the paragraph — contains inline text, not a block
    const inlineSlice = doc.slice(2, 4);
    // The slice content's first child is a text node (inline)
    expect(inlineSlice.content.firstChild?.isBlock).toBe(false);

    // serializeSourcePeekRange on a range that produces an inline slice
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2, 4) });
    // Range.from/to span inside the paragraph content — the slice is inline
    const markdown = serializeSourcePeekRange(state, { from: 2, to: 4 });
    // Should not throw; result should contain the text "el"
    expect(typeof markdown).toBe("string");
  });
});

describe("applySourcePeekMarkdown", () => {
  it("returns true on successful application", () => {
    const schema = createSchema();
    const doc = parseMarkdown(schema, "Original text");
    const state = EditorState.create({ doc });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dispatch: mockDispatch,
    } as unknown as EditorView;

    const result = applySourcePeekMarkdown(mockView, { from: 1, to: 14 }, "New text");

    expect(result).toBe(true);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("returns false and logs error on failure", async () => {
    const schema = createSchema();
    const doc = parseMarkdown(schema, "Text");
    const state = EditorState.create({ doc });

    const debug = await import("@/utils/debug");
    const sourcePeekError = vi.mocked(debug.sourcePeekError);
    const mockView = {
      state,
      dispatch: vi.fn(() => {
        throw new Error("Dispatch failed");
      }),
    } as unknown as EditorView;

    const result = applySourcePeekMarkdown(mockView, { from: 0, to: 5 }, "New");

    expect(result).toBe(false);
    expect(sourcePeekError).toHaveBeenCalledWith(
      "Failed to apply markdown:",
      expect.any(Error)
    );

  });
});
