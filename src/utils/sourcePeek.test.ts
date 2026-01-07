import { describe, expect, it } from "vitest";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { Table, TableRow } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { parseMarkdownToTiptapDoc } from "@/utils/tiptapMarkdown";
import { highlightExtension } from "@/plugins/highlight/tiptap";
import { subscriptExtension, superscriptExtension } from "@/plugins/subSuperscript/tiptap";
import { alertBlockExtension } from "@/plugins/alertBlock/tiptap";
import { detailsBlockExtension, detailsSummaryExtension } from "@/plugins/detailsBlock/tiptap";
import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { blockImageExtension } from "@/plugins/blockImage/tiptap";
import { footnoteDefinitionExtension, footnoteReferenceExtension } from "@/plugins/footnotePopup/tiptapNodes";
import { mathInlineExtension } from "@/plugins/latex/tiptapInlineMath";
import { AlignedTableCell, AlignedTableHeader } from "@/components/Editor/alignedTableNodes";
import { createSourcePeekSlice, getSourcePeekRange, serializeSourcePeekRange } from "./sourcePeek";

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
  it("builds a top-level block range for the selection", () => {
    const schema = createSchema();
    const doc = parseMarkdownToTiptapDoc(schema, "Alpha\n\nBeta");
    const selection = TextSelection.create(doc, 1);
    const state = EditorState.create({ doc, selection });

    const range = getSourcePeekRange(state);
    const slice = doc.slice(range.from, range.to);

    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.textContent).toBe("Alpha");
  });

  it("serializes the selection range to markdown", () => {
    const schema = createSchema();
    const doc = parseMarkdownToTiptapDoc(schema, "Alpha\n\nBeta");
    const selection = TextSelection.create(doc, 1);
    const state = EditorState.create({ doc, selection });

    const range = getSourcePeekRange(state);
    const markdown = serializeSourcePeekRange(state, range).trim();

    expect(markdown).toBe("Alpha");
  });

  it("creates a slice with a paragraph when markdown is empty", () => {
    const schema = createSchema();
    const slice = createSourcePeekSlice(schema, "");

    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.type.name).toBe("paragraph");
  });

  it("uses node selection bounds for block selections", () => {
    const schema = createSchema();
    const blockImage = schema.nodes.block_image.create({ src: "image.png", alt: "", title: "" });
    const doc = schema.nodes.doc.create(null, [blockImage]);
    const selection = NodeSelection.create(doc, 0);
    const state = EditorState.create({ doc, selection });

    const range = getSourcePeekRange(state);

    expect(range).toEqual({ from: selection.from, to: selection.to });
  });
});
