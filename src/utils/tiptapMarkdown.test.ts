import { describe, expect, it } from "vitest";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { parseMarkdownToTiptapDoc, serializeTiptapDocToMarkdown } from "./tiptapMarkdown";

const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: {
        default: null,
      },
    };
  },
});

const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: {
        default: null,
      },
    };
  },
});

function createSchema() {
  return getSchema([
    StarterKit,
    Image,
    Table.configure({ resizable: false }),
    TableRow,
    AlignedTableHeader,
    AlignedTableCell,
  ]);
}

describe("tiptapMarkdown table support", () => {
  it("round-trips a basic table", () => {
    const schema = createSchema();
    const input = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");

    const doc = parseMarkdownToTiptapDoc(schema, input);
    const output = serializeTiptapDocToMarkdown(doc).trim();

    expect(output).toBe(input);
  });

  it("preserves column alignment markers", () => {
    const schema = createSchema();
    const input = ["| a | b |", "| ---: | :--- |", "| 1 | 2 |"].join("\n");

    const doc = parseMarkdownToTiptapDoc(schema, input);
    const output = serializeTiptapDocToMarkdown(doc).trim();

    expect(output).toBe(input);
  });
});
