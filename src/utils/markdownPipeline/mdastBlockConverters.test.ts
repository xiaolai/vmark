/**
 * Tests for MDAST block node converters (MDAST -> ProseMirror).
 *
 * Tests converter functions directly for edge cases not covered by
 * the integration tests in mdastToProseMirror.blocks.test.ts.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type {
  Paragraph,
  Heading,
  Code,
  Blockquote,
  List,
  ListItem,
  ThematicBreak,
  Table,
  Html,
  Definition,
  FootnoteDefinition,
} from "mdast";
import type { Math } from "mdast-util-math";
import type { Alert, Details, WikiLink, Yaml } from "./types";
import {
  convertParagraph,
  convertHeading,
  convertCode,
  convertBlockquote,
  convertList,
  convertListItem,
  convertThematicBreak,
  convertTable,
  convertMathBlock,
  convertDefinition,
  convertFrontmatter,
  convertDetails,
  convertAlert,
  convertWikiLink,
  convertHtml,
  convertFootnoteDefinition,
  convertAlertBlockquote,
  MATH_BLOCK_LANGUAGE,
  type MdastToPmContext,
} from "./mdastBlockConverters";
import { testSchema } from "./testSchema";

function createContext(schema: Schema = testSchema): MdastToPmContext {
  return {
    schema,
    convertChildren: (_children, _marks, _context) => {
      // Simple mock that converts text children to PM text nodes
      const result: import("@tiptap/pm/model").Node[] = [];
      for (const child of _children) {
        if (child.type === "text" && "value" in child) {
          result.push(schema.text(String(child.value)));
        }
      }
      return result;
    },
  };
}

/** Minimal schema missing optional node types */
const minimalSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
});

describe("mdastBlockConverters", () => {
  const context = createContext();

  describe("convertParagraph", () => {
    it("creates paragraph with text children", () => {
      const node: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: "hello" }],
      };
      const result = convertParagraph(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("paragraph");
    });

    it("returns null when paragraph not in schema", () => {
      const schema = new Schema({
        nodes: { doc: { content: "text*" }, text: {} },
      });
      const ctx = createContext(schema);
      const node: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: "hello" }],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).toBeNull();
    });

    it("sets sourceLine from position when schema supports it", () => {
      const schemaWithSourceLine = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { attrs: { sourceLine: { default: null } }, content: "inline*", group: "block" },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(schemaWithSourceLine);
      const node: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: "hello" }],
        position: { start: { line: 5, column: 1 }, end: { line: 5, column: 6 } },
      };
      const result = convertParagraph(ctx, node, []);
      expect(result!.attrs.sourceLine).toBe(5);
    });

    it("handles paragraph with no position when schema supports sourceLine", () => {
      const schemaWithSourceLine = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { attrs: { sourceLine: { default: null } }, content: "inline*", group: "block" },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(schemaWithSourceLine);
      const node: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: "hello" }],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result!.attrs.sourceLine).toBeNull();
    });
  });

  describe("convertHeading", () => {
    it("creates heading with correct depth", () => {
      const node: Heading = {
        type: "heading",
        depth: 3,
        children: [{ type: "text", value: "Title" }],
      };
      const result = convertHeading(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("heading");
      expect(result!.attrs.level).toBe(3);
    });

    it("generates heading ID when generateHeadingId is provided", () => {
      // Need a schema with id attr on heading
      const schemaWithId = new Schema({
        nodes: {
          doc: { content: "block+" },
          heading: {
            attrs: { level: { default: 1 }, sourceLine: { default: null }, id: { default: null } },
            content: "inline*",
            group: "block",
          },
          paragraph: { content: "inline*", group: "block" },
          text: { group: "inline" },
        },
      });
      const ctx: MdastToPmContext = {
        schema: schemaWithId,
        convertChildren: (_children, _marks, _context) => {
          const result: import("@tiptap/pm/model").Node[] = [];
          for (const child of _children) {
            if (child.type === "text" && "value" in child) {
              result.push(schemaWithId.text(String(child.value)));
            }
          }
          return result;
        },
        generateHeadingId: (text: string) => `id-${text.toLowerCase().replace(/\s+/g, "-")}`,
      };
      const node: Heading = {
        type: "heading",
        depth: 1,
        children: [{ type: "text", value: "Hello World" }],
      };
      const result = convertHeading(ctx, node, []);
      expect(result!.attrs.id).toBe("id-hello-world");
    });

    it("includes text nested in emphasis/strong/links/inline code in the heading ID", () => {
      const seen: string[] = [];
      const ctx: MdastToPmContext = {
        ...createContext(),
        generateHeadingId: (text: string) => {
          seen.push(text);
          return null;
        },
      };
      const node: Heading = {
        type: "heading",
        depth: 2,
        children: [
          { type: "text", value: "Hello " },
          { type: "emphasis", children: [{ type: "text", value: "brave " }] },
          { type: "strong", children: [{ type: "text", value: "new " }] },
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", value: "world " }],
          },
          { type: "inlineCode", value: "code" },
        ],
      };
      convertHeading(ctx, node, []);
      expect(seen).toEqual(["Hello brave new world code"]);
    });

    it("returns null when heading not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Heading = { type: "heading", depth: 1, children: [] };
      const result = convertHeading(ctx, node, []);
      expect(result).toBeNull();
    });
  });

  describe("convertCode", () => {
    it("creates codeBlock with language", () => {
      const node: Code = { type: "code", lang: "javascript", value: "const x = 1;" };
      const result = convertCode(context, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("codeBlock");
      expect(result!.attrs.language).toBe("javascript");
    });

    it("handles null language", () => {
      const node: Code = { type: "code", value: "plain code" };
      const result = convertCode(context, node);
      expect(result!.attrs.language).toBeNull();
    });

    it("handles empty value", () => {
      const node: Code = { type: "code", value: "" };
      const result = convertCode(context, node);
      expect(result).not.toBeNull();
      expect(result!.content.size).toBe(0);
    });

    it("returns null when codeBlock not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Code = { type: "code", value: "code" };
      const result = convertCode(ctx, node);
      expect(result).toBeNull();
    });
  });

  describe("convertBlockquote", () => {
    it("creates blockquote node", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "quote" }] }],
      };
      const result = convertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("blockquote");
    });

    it("detects alert syntax and creates alertBlock instead", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!WARNING]\nBe careful" }],
          },
        ],
      };
      const result = convertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("alertBlock");
      expect(result!.attrs.alertType).toBe("WARNING");
    });

    it("returns null when blockquote not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Blockquote = {
        type: "blockquote",
        children: [{ type: "paragraph", children: [] }],
      };
      const result = convertBlockquote(ctx, node, []);
      expect(result).toBeNull();
    });

    it("inserts an empty paragraph when converted children are empty (schema requires block+)", () => {
      const node: Blockquote = { type: "blockquote", children: [] };
      const result = convertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("blockquote");
      expect(result!.childCount).toBe(1);
      expect(result!.child(0).type.name).toBe("paragraph");
    });
  });

  describe("convertList", () => {
    it("creates bulletList", () => {
      const node: List = {
        type: "list",
        ordered: false,
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [{ type: "text", value: "item" }] }] },
        ],
      };
      const result = convertList(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("bulletList");
    });

    it("creates orderedList with start attribute", () => {
      const node: List = {
        type: "list",
        ordered: true,
        start: 3,
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [{ type: "text", value: "item" }] }] },
        ],
      };
      const result = convertList(context, node, []);
      expect(result!.type.name).toBe("orderedList");
      expect(result!.attrs.start).toBe(3);
    });

    it("defaults ordered start to 1", () => {
      const node: List = {
        type: "list",
        ordered: true,
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [] }] },
        ],
      };
      const result = convertList(context, node, []);
      expect(result!.attrs.start).toBe(1);
    });

    it("defaults ordered to false when undefined", () => {
      const node = {
        type: "list",
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [] }] },
        ],
      } as List;
      const result = convertList(context, node, []);
      expect(result!.type.name).toBe("bulletList");
    });

    it("returns null when bulletList not in schema (line 180 guard)", () => {
      const ctx = createContext(minimalSchema);
      const node: List = {
        type: "list",
        ordered: false,
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [] }] },
        ],
      };
      const result = convertList(ctx, node, []);
      expect(result).toBeNull();
    });

    it("returns null when orderedList not in schema (line 180 guard)", () => {
      const ctx = createContext(minimalSchema);
      const node: List = {
        type: "list",
        ordered: true,
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [] }] },
        ],
      };
      const result = convertList(ctx, node, []);
      expect(result).toBeNull();
    });
  });

  describe("convertListItem", () => {
    it("creates listItem with checked attribute", () => {
      const node: ListItem = {
        type: "listItem",
        checked: true,
        children: [{ type: "paragraph", children: [{ type: "text", value: "done" }] }],
      };
      const result = convertListItem(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.attrs.checked).toBe(true);
    });

    it("creates listItem without checked when null", () => {
      const node: ListItem = {
        type: "listItem",
        children: [{ type: "paragraph", children: [{ type: "text", value: "item" }] }],
      };
      const result = convertListItem(context, node, []);
      // checked defaults to null in schema
      expect(result!.attrs.checked).toBeNull();
    });

    it("inserts empty paragraph for empty listItem", () => {
      const ctx: MdastToPmContext = {
        ...context,
        convertChildren: () => [], // simulate no children
      };
      const node: ListItem = { type: "listItem", children: [] };
      const result = convertListItem(ctx, node, []);
      expect(result).not.toBeNull();
      // Should have a fallback paragraph
      expect(result!.childCount).toBe(1);
      expect(result!.firstChild!.type.name).toBe("paragraph");
    });

    it("returns null when listItem not in schema (line 194 guard)", () => {
      const ctx = createContext(minimalSchema);
      const node: ListItem = {
        type: "listItem",
        children: [{ type: "paragraph", children: [] }],
      };
      const result = convertListItem(ctx, node, []);
      expect(result).toBeNull();
    });
  });

  describe("convertThematicBreak", () => {
    it("creates horizontalRule", () => {
      const node: ThematicBreak = { type: "thematicBreak" };
      const result = convertThematicBreak(context, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("horizontalRule");
    });

    it("returns null when horizontalRule not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: ThematicBreak = { type: "thematicBreak" };
      const result = convertThematicBreak(ctx, node);
      expect(result).toBeNull();
    });
  });

  describe("convertTable", () => {
    it("creates table with header and data rows", () => {
      const node: Table = {
        type: "table",
        align: ["left", "center"],
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "A" }] },
              { type: "tableCell", children: [{ type: "text", value: "B" }] },
            ],
          },
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "1" }] },
              { type: "tableCell", children: [{ type: "text", value: "2" }] },
            ],
          },
        ],
      };
      const result = convertTable(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("table");
      expect(result!.childCount).toBe(2);
    });

    it("returns null when table node types missing from schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Table = {
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [{ type: "tableCell", children: [{ type: "text", value: "A" }] }],
          },
        ],
      };
      const result = convertTable(ctx, node, []);
      expect(result).toBeNull();
    });

    it("handles table with no alignment", () => {
      const node: Table = {
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [{ type: "tableCell", children: [{ type: "text", value: "A" }] }],
          },
        ],
      };
      const result = convertTable(context, node, []);
      expect(result).not.toBeNull();
    });
  });

  describe("convertMathBlock", () => {
    it("creates codeBlock with math sentinel language", () => {
      const node = { type: "math", value: "x^2 + y^2" } as Math;
      const result = convertMathBlock(context, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("codeBlock");
      expect(result!.attrs.language).toBe(MATH_BLOCK_LANGUAGE);
    });

    it("handles empty math value", () => {
      const node = { type: "math", value: "" } as Math;
      const result = convertMathBlock(context, node);
      expect(result).not.toBeNull();
      expect(result!.content.size).toBe(0);
    });

    it("returns null when codeBlock not in schema (line 263 guard)", () => {
      const ctx = createContext(minimalSchema);
      const node = { type: "math", value: "x^2" } as Math;
      const result = convertMathBlock(ctx, node);
      expect(result).toBeNull();
    });
  });

  describe("convertDefinition", () => {
    it("creates link_definition node", () => {
      const node: Definition = {
        type: "definition",
        identifier: "ref",
        label: "Ref",
        url: "https://example.com",
        title: "Title",
      };
      const result = convertDefinition(context, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("link_definition");
      expect(result!.attrs.identifier).toBe("ref");
      expect(result!.attrs.url).toBe("https://example.com");
    });

    it("handles missing label and title", () => {
      const node: Definition = {
        type: "definition",
        identifier: "ref",
        url: "https://example.com",
      };
      const result = convertDefinition(context, node);
      expect(result!.attrs.label).toBeNull();
      expect(result!.attrs.title).toBeNull();
    });

    it("returns null when link_definition not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Definition = { type: "definition", identifier: "ref", url: "url" };
      const result = convertDefinition(ctx, node);
      expect(result).toBeNull();
    });
  });

  describe("convertFrontmatter", () => {
    it("creates frontmatter node", () => {
      const node: Yaml = { type: "yaml", value: "title: Test" };
      const result = convertFrontmatter(context, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("frontmatter");
      expect(result!.attrs.value).toBe("title: Test");
    });

    it("handles empty frontmatter value", () => {
      const node = { type: "yaml", value: "" } as Yaml;
      const result = convertFrontmatter(context, node);
      expect(result!.attrs.value).toBe("");
    });

    it("returns null when frontmatter not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Yaml = { type: "yaml", value: "title: Test" };
      const result = convertFrontmatter(ctx, node);
      expect(result).toBeNull();
    });
  });

  describe("convertDetails", () => {
    it("creates detailsBlock with summary", () => {
      const node: Details = {
        type: "details",
        open: true,
        summary: "Click me",
        children: [{ type: "paragraph", children: [{ type: "text", value: "Hidden" }] }],
      };
      const result = convertDetails(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("detailsBlock");
      expect(result!.attrs.open).toBe(true);
    });

    it("defaults summary to 'Details' when missing", () => {
      const node: Details = {
        type: "details",
        children: [{ type: "paragraph", children: [{ type: "text", value: "Content" }] }],
      };
      const result = convertDetails(context, node, []);
      expect(result).not.toBeNull();
      // The summary node should be created with default text
      const summaryChild = result!.firstChild;
      expect(summaryChild!.type.name).toBe("detailsSummary");
    });

    it("returns null when detailsBlock not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Details = { type: "details", children: [] };
      const result = convertDetails(ctx, node, []);
      expect(result).toBeNull();
    });

    it("inserts empty paragraph when children are empty", () => {
      const ctx: MdastToPmContext = {
        ...context,
        convertChildren: (_children, _marks, ctxType) => {
          // Return empty for block children, non-empty for inline (summary)
          if (ctxType === "block") return [];
          return [testSchema.text("Summary")];
        },
      };
      const node: Details = {
        type: "details",
        summary: "Summary",
        children: [],
      };
      const result = convertDetails(ctx, node, []);
      expect(result).not.toBeNull();
      // Should have summary + at least one block child (empty paragraph)
      expect(result!.childCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("convertAlert", () => {
    it("creates alertBlock with type", () => {
      const node: Alert = {
        type: "alert",
        alertType: "TIP",
        children: [{ type: "paragraph", children: [{ type: "text", value: "Tip text" }] }],
      };
      const result = convertAlert(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("alertBlock");
      expect(result!.attrs.alertType).toBe("TIP");
    });

    it("returns null when alertBlock not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Alert = { type: "alert", alertType: "NOTE", children: [] };
      const result = convertAlert(ctx, node, []);
      expect(result).toBeNull();
    });

    it("inserts empty paragraph when children are empty", () => {
      const ctx: MdastToPmContext = {
        ...context,
        convertChildren: () => [],
      };
      const node: Alert = { type: "alert", alertType: "NOTE", children: [] };
      const result = convertAlert(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.childCount).toBe(1);
      expect(result!.firstChild!.type.name).toBe("paragraph");
    });
  });

  describe("convertWikiLink", () => {
    it("creates wikiLink with value and alias", () => {
      const node: WikiLink = { type: "wikiLink", value: "Page", alias: "Alias" };
      const result = convertWikiLink(context, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("wikiLink");
      expect(result!.attrs.value).toBe("Page");
      expect(result!.textContent).toBe("Alias");
    });

    it("creates wikiLink without alias", () => {
      const node: WikiLink = { type: "wikiLink", value: "Page" };
      const result = convertWikiLink(context, node);
      expect(result!.attrs.value).toBe("Page");
      expect(result!.textContent).toBe("Page");
    });

    it("returns null when wikiLink not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: WikiLink = { type: "wikiLink", value: "Page" };
      const result = convertWikiLink(ctx, node);
      expect(result).toBeNull();
    });
  });

  describe("convertHtml", () => {
    it("creates html_block for block context", () => {
      const node: Html = { type: "html", value: "<div>content</div>" };
      const result = convertHtml(context, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_block");
      expect(result!.attrs.value).toBe("<div>content</div>");
    });

    it("creates html_inline for inline context", () => {
      const node: Html = { type: "html", value: "<kbd>X</kbd>" };
      const result = convertHtml(context, node, true);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_inline");
    });

    it("handles empty HTML value", () => {
      const node: Html = { type: "html", value: "" };
      const result = convertHtml(context, node, false);
      expect(result!.attrs.value).toBe("");
    });

    it("returns null when html_block not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Html = { type: "html", value: "<div>x</div>" };
      const result = convertHtml(ctx, node, false);
      expect(result).toBeNull();
    });
  });

  describe("convertFootnoteDefinition", () => {
    it("creates footnote_definition node", () => {
      const node = {
        type: "footnoteDefinition",
        identifier: "1",
        children: [{ type: "paragraph", children: [{ type: "text", value: "Footnote" }] }],
      } as unknown as FootnoteDefinition;
      const result = convertFootnoteDefinition(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("footnote_definition");
      expect(result!.attrs.label).toBe("1");
    });

    it("returns null when footnote_definition not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node = {
        type: "footnoteDefinition",
        identifier: "1",
        children: [],
      } as unknown as FootnoteDefinition;
      const result = convertFootnoteDefinition(ctx, node, []);
      expect(result).toBeNull();
    });
  });

  describe("convertAlertBlockquote", () => {
    it("detects [!NOTE] marker", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!NOTE]\nSome note" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("alertBlock");
      expect(result!.attrs.alertType).toBe("NOTE");
    });

    it("detects all alert types", () => {
      for (const alertType of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
        const node: Blockquote = {
          type: "blockquote",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: `[!${alertType}]` }],
            },
          ],
        };
        const result = convertAlertBlockquote(context, node, []);
        expect(result).not.toBeNull();
        expect(result!.attrs.alertType).toBe(alertType);
      }
    });

    it("returns null for non-alert blockquote", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Just a quote" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).toBeNull();
    });

    it("returns null when first child is not paragraph", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [{ type: "code", value: "code" }],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).toBeNull();
    });

    it("returns null when blockquote is empty", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).toBeNull();
    });

    it("returns null when alertBlock not in schema", () => {
      const ctx = createContext(minimalSchema);
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!NOTE]\nContent" }],
          },
        ],
      };
      const result = convertAlertBlockquote(ctx, node, []);
      expect(result).toBeNull();
    });

    it("handles alert marker with remaining text on first line", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!TIP] This is a tip" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.attrs.alertType).toBe("TIP");
    });

    it("strips break node after alert marker", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "[!NOTE]" },
              { type: "break" },
              { type: "text", value: "Content" },
            ],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.attrs.alertType).toBe("NOTE");
    });

    it("handles case-insensitive alert type", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!note]\nContent" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.attrs.alertType).toBe("NOTE");
    });
  });

  describe("MATH_BLOCK_LANGUAGE sentinel", () => {
    it("has expected value", () => {
      expect(MATH_BLOCK_LANGUAGE).toBe("$$math$$");
    });
  });

  describe("convertHtml — video/audio/iframe promotion", () => {
    // Extended schema with block_video, block_audio, video_embed
    const mediaSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          content: "inline*",
          group: "block",
          attrs: { sourceLine: { default: null } },
        },
        block_video: {
          attrs: {
            src: { default: "" },
            title: { default: "" },
            poster: { default: "" },
            controls: { default: true },
            preload: { default: "metadata" },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        block_audio: {
          attrs: {
            src: { default: "" },
            title: { default: "" },
            controls: { default: true },
            preload: { default: "metadata" },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        video_embed: {
          attrs: {
            provider: { default: "" },
            videoId: { default: "" },
            width: { default: 560 },
            height: { default: 315 },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        html_block: {
          attrs: { value: { default: "" }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        html_inline: {
          attrs: { value: { default: "" }, sourceLine: { default: null } },
          inline: true,
          group: "inline",
          atom: true,
        },
        text: { group: "inline" },
      },
    });

    const mediaCtx = createContext(mediaSchema);

    it("promotes <video> HTML to block_video", () => {
      const node: Html = {
        type: "html",
        value: '<video src="movie.mp4" controls title="My Video"></video>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.src).toBe("movie.mp4");
      expect(result!.attrs.title).toBe("My Video");
      expect(result!.attrs.controls).toBe(true);
    });

    it("promotes <audio> HTML to block_audio", () => {
      const node: Html = {
        type: "html",
        value: '<audio src="song.mp3" controls preload="auto"></audio>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
      expect(result!.attrs.src).toBe("song.mp3");
      expect(result!.attrs.preload).toBe("auto");
    });

    it("promotes YouTube iframe to video_embed", () => {
      const node: Html = {
        type: "html",
        value: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="640" height="360"></iframe>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("video_embed");
      expect(result!.attrs.provider).toBe("youtube");
      expect(result!.attrs.videoId).toBe("dQw4w9WgXcQ");
      expect(result!.attrs.width).toBe(640);
      expect(result!.attrs.height).toBe(360);
    });

    it("does not promote non-video iframe to video_embed", () => {
      const node: Html = {
        type: "html",
        value: '<iframe src="https://example.com/page"></iframe>',
      };
      const result = convertHtml(mediaCtx, node, false);
      // Not a recognized video provider, falls through to html_block
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_block");
    });

    it("returns null when video_embed not in schema but iframe has recognized provider (line 409 guard)", () => {
      // Build a schema that has html_block but NOT video_embed
      const noEmbedSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { content: "inline*", group: "block" },
          html_block: {
            attrs: { value: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(noEmbedSchema);
      const node: Html = {
        type: "html",
        value: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      };
      const result = convertHtml(ctx, node, false);
      // video_embed not in schema → tryPromoteMediaHtml returns null → falls to html_block
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_block");
    });

    it("returns html_block when iframe src has recognized provider but no extractable video ID (line 415 guard)", () => {
      // A YouTube embed URL that has no video ID segment
      const node: Html = {
        type: "html",
        value: '<iframe src="https://www.youtube.com/embed/"></iframe>',
      };
      const result = convertHtml(mediaCtx, node, false);
      // Provider detected (youtube) but videoId is empty/null → falls through to html_block
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_block");
    });

    it("does not promote inline HTML with video tag", () => {
      const node: Html = {
        type: "html",
        value: '<video src="movie.mp4" controls></video>',
      };
      // In inline context, tryPromoteMediaHtml is not called
      const result = convertHtml(mediaCtx, node, true);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_inline");
    });

    it("promotes <video> with poster attribute", () => {
      const node: Html = {
        type: "html",
        value: '<video src="movie.mp4" poster="thumb.jpg"></video>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.poster).toBe("thumb.jpg");
    });

    it("handles video without controls attribute", () => {
      const node: Html = {
        type: "html",
        value: '<video src="movie.mp4"></video>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.controls).toBe(false);
    });

    it("handles single-quoted attributes", () => {
      const node: Html = {
        type: "html",
        value: "<video src='movie.mp4' controls></video>",
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.src).toBe("movie.mp4");
    });

    it("falls back to html_block when block_video not in schema", () => {
      const noVideoSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { content: "inline*", group: "block" },
          html_block: {
            attrs: { value: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(noVideoSchema);
      const node: Html = {
        type: "html",
        value: '<video src="movie.mp4" controls></video>',
      };
      const result = convertHtml(ctx, node, false);
      // block_video not in schema, falls through to html_block
      expect(result!.type.name).toBe("html_block");
    });

    it("falls back to html_block when block_audio not in schema", () => {
      const noAudioSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { content: "inline*", group: "block" },
          html_block: {
            attrs: { value: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(noAudioSchema);
      const node: Html = {
        type: "html",
        value: '<audio src="song.mp3" controls></audio>',
      };
      const result = convertHtml(ctx, node, false);
      expect(result!.type.name).toBe("html_block");
    });
  });

  describe("convertParagraph — inline HTML video/audio promotion", () => {
    const mediaSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          content: "inline*",
          group: "block",
          attrs: { sourceLine: { default: null } },
        },
        block_video: {
          attrs: {
            src: { default: "" }, title: { default: "" }, poster: { default: "" },
            controls: { default: true }, preload: { default: "metadata" },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        block_audio: {
          attrs: {
            src: { default: "" }, title: { default: "" },
            controls: { default: true }, preload: { default: "metadata" },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        html_block: {
          attrs: { value: { default: "" }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        text: { group: "inline" },
      },
    });

    it("promotes paragraph with single inline-html <video> to block_video", () => {
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "html", value: '<video src="clip.mp4" controls></video>' },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
    });

    it("promotes paragraph with single inline-html <audio> to block_audio", () => {
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "html", value: '<audio src="track.mp3" controls></audio>' },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
    });
  });

  describe("convertParagraph — video/audio image promotion", () => {
    const mediaSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          content: "inline*",
          group: "block",
          attrs: { sourceLine: { default: null } },
        },
        block_video: {
          attrs: {
            src: { default: "" }, title: { default: "" },
            controls: { default: true }, preload: { default: "metadata" },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        block_audio: {
          attrs: {
            src: { default: "" }, title: { default: "" },
            controls: { default: true }, preload: { default: "metadata" },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        block_image: {
          attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        image: {
          attrs: { src: {}, alt: { default: null }, title: { default: null } },
          inline: true,
          group: "inline",
        },
        text: { group: "inline" },
      },
    });

    it("promotes single image child with video extension to block_video", () => {
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "clip.mp4", alt: "video", title: "My Video" },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.src).toBe("clip.mp4");
    });

    it("promotes single image child with audio extension to block_audio", () => {
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "track.mp3", alt: "audio", title: "" },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
      expect(result!.attrs.src).toBe("track.mp3");
    });
  });

  describe("convertAlertBlockquote — additional edge cases", () => {
    it("returns null for first child with non-text first child", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "image", url: "img.png", alt: "" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).toBeNull();
    });

    it("handles alert with empty children (paragraph removed)", () => {
      // When [!NOTE] marker consumes entire text and no break follows
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!WARNING]" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.attrs.alertType).toBe("WARNING");
    });

    it("handles alert with additional blockquote children after first paragraph", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!CAUTION]" }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", value: "Extra content" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.attrs.alertType).toBe("CAUTION");
    });
  });

  describe("stripAlertMarker — invalid alert type returns null (line 498)", () => {
    it("returns null for marker with invalid alert type (not in ALERT_TYPES)", () => {
      // [!INVALID] is not in the allowed ALERT_TYPES list
      const node: Blockquote = {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "[!INVALID]\nContent" }],
          },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      // stripAlertMarker returns null because INVALID is not in ALERT_TYPES
      // so convertAlertBlockquote returns null and falls through to blockquote
      expect(result).toBeNull();
    });
  });

  describe("convertParagraph — null-coalescing fallback branches", () => {
    it("promotes image with missing url to block_image (url ?? '' branch)", () => {
      const mediaSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: {
            content: "inline*",
            group: "block",
            attrs: { sourceLine: { default: null } },
          },
          block_image: {
            attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          image: {
            attrs: { src: {}, alt: { default: null }, title: { default: null } },
            inline: true,
            group: "inline",
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "test.png", alt: "alt" },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_image");
    });

    it("promotes image with missing title to block_video (title ?? '' branch)", () => {
      const mediaSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: {
            content: "inline*",
            group: "block",
            attrs: { sourceLine: { default: null } },
          },
          block_video: {
            attrs: {
              src: { default: "" }, title: { default: "" },
              controls: { default: true }, preload: { default: "metadata" },
              sourceLine: { default: null },
            },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "clip.mp4", alt: "" },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.title).toBe("");
    });

    it("promotes image with missing title to block_audio (title ?? '' branch)", () => {
      const mediaSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: {
            content: "inline*",
            group: "block",
            attrs: { sourceLine: { default: null } },
          },
          block_audio: {
            attrs: {
              src: { default: "" }, title: { default: "" },
              controls: { default: true }, preload: { default: "metadata" },
              sourceLine: { default: null },
            },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "song.mp3", alt: "" },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
      expect(result!.attrs.title).toBe("");
    });
  });

  describe("convertParagraph — block_image fallback when no video/audio match", () => {
    it("falls through to block_image when image URL has no video/audio extension (line 114)", () => {
      // URL has no extension at all, so hasVideoExtension and hasAudioExtension return false
      const mediaSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: {
            content: "inline*",
            group: "block",
            attrs: { sourceLine: { default: null } },
          },
          block_video: {
            attrs: { src: { default: "" }, title: { default: "" }, controls: { default: true }, preload: { default: "metadata" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          block_audio: {
            attrs: { src: { default: "" }, title: { default: "" }, controls: { default: true }, preload: { default: "metadata" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          block_image: {
            attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          image: {
            attrs: { src: {}, alt: { default: null }, title: { default: null } },
            inline: true,
            group: "inline",
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "photo.jpg", alt: "photo", title: "Photo" },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_image");
      expect(result!.attrs.src).toBe("photo.jpg");
      expect(result!.attrs.alt).toBe("photo");
    });
  });

  describe("convertTable — null-coalescing branches", () => {
    it("handles table with no align property (align ?? [] fallback, line 230)", () => {
      const node: Table = {
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "A" }] },
            ],
          },
        ],
      };
      // Remove align entirely to trigger ?? [] fallback
      delete (node as any).align;
      const result = convertTable(context, node, []);
      expect(result).not.toBeNull();
    });

    it("handles cell alignment not null (supportsAlignmentAttr branch, line 246)", () => {
      // This exercises the branch where alignment is not null and supportsAlignmentAttr returns true
      const node: Table = {
        type: "table",
        align: ["center"],
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "Centered" }] },
            ],
          },
        ],
      };
      const result = convertTable(context, node, []);
      expect(result).not.toBeNull();
      // The first (header) cell should get alignment = center
      const headerRow = result!.firstChild;
      const cell = headerRow?.firstChild;
      expect(cell?.attrs.alignment).toBe("center");
    });
  });

  describe("convertFrontmatter — null-coalescing (value ?? '' branch, line 283)", () => {
    it("handles frontmatter with undefined value", () => {
      const node = { type: "yaml" } as Yaml;
      const result = convertFrontmatter(context, node);
      expect(result).not.toBeNull();
      expect(result!.attrs.value).toBe("");
    });
  });

  describe("convertDetails — summaryPmNodes empty branch (line 304)", () => {
    it("creates details with empty summary when summary text produces no PM nodes", () => {
      const ctx: MdastToPmContext = {
        ...context,
        convertChildren: (_children, _marks, ctxType) => {
          // Return empty for inline summary, non-empty for block body
          if (ctxType === "inline") return [];
          return [testSchema.nodes.paragraph.create()];
        },
      };
      const node: Details = {
        type: "details",
        summary: "",
        children: [{ type: "paragraph", children: [] }],
      };
      const result = convertDetails(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.firstChild!.type.name).toBe("detailsSummary");
    });
  });

  describe("convertWikiLink — empty value and alias branches", () => {
    it("handles wikiLink with empty alias (uses value as display text, line 336)", () => {
      const node: WikiLink = { type: "wikiLink", value: "Page", alias: "" };
      const result = convertWikiLink(context, node);
      expect(result).not.toBeNull();
      // alias is empty so displayText = value
      expect(result!.textContent).toBe("Page");
    });

    it("handles wikiLink with empty value (line 340)", () => {
      const node: WikiLink = { type: "wikiLink", value: "" };
      const result = convertWikiLink(context, node);
      expect(result).not.toBeNull();
      // displayText is empty, textNode is null
      expect(result!.textContent).toBe("");
    });
  });

  describe("convertHtml — null-coalescing (value ?? '' branch, line 349)", () => {
    it("handles html node with undefined value", () => {
      const node = { type: "html" } as Html;
      const result = convertHtml(context, node, false);
      expect(result).not.toBeNull();
      expect(result!.attrs.value).toBe("");
    });
  });

  describe("tryPromoteMediaHtml — null-coalescing branches for attributes", () => {
    const mediaSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block", attrs: { sourceLine: { default: null } } },
        block_video: {
          attrs: { src: { default: "" }, title: { default: "" }, poster: { default: "" }, controls: { default: true }, preload: { default: "metadata" }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        block_audio: {
          attrs: { src: { default: "" }, title: { default: "" }, controls: { default: true }, preload: { default: "metadata" }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        video_embed: {
          attrs: { provider: { default: "" }, videoId: { default: "" }, width: { default: 560 }, height: { default: 315 }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        html_block: { attrs: { value: { default: "" }, sourceLine: { default: null } }, group: "block", atom: true },
        html_inline: { attrs: { value: { default: "" }, sourceLine: { default: null } }, inline: true, group: "inline", atom: true },
        text: { group: "inline" },
      },
    });
    const mediaCtx = createContext(mediaSchema);

    it("handles video tag with no src attribute (src ?? '' branch, line 381)", () => {
      const node: Html = { type: "html", value: "<video controls></video>" };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.src).toBe("");
    });

    it("handles audio tag with no src attribute (src ?? '' branch, line 397)", () => {
      const node: Html = { type: "html", value: "<audio controls></audio>" };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
      expect(result!.attrs.src).toBe("");
    });

    it("handles iframe with width/height that parse to NaN (fallback to default, lines 420-421)", () => {
      const node: Html = {
        type: "html",
        value: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="abc" height="xyz"></iframe>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("video_embed");
      // parseInt("abc") is NaN, so || 560 kicks in
      expect(result!.attrs.width).toBe(560);
      expect(result!.attrs.height).toBe(315);
    });

    it("handles iframe without width/height attributes (config default fallback, lines 420-421)", () => {
      const node: Html = {
        type: "html",
        value: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("video_embed");
      expect(result!.attrs.width).toBe(560);
      expect(result!.attrs.height).toBe(315);
    });

    it("handles Vimeo iframe (exercises different provider config path)", () => {
      const node: Html = {
        type: "html",
        value: '<iframe src="https://player.vimeo.com/video/123456789"></iframe>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("video_embed");
      expect(result!.attrs.provider).toBe("vimeo");
    });

    it("handles Bilibili iframe", () => {
      const node: Html = {
        type: "html",
        value: '<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD"></iframe>',
      };
      const result = convertHtml(mediaCtx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("video_embed");
      expect(result!.attrs.provider).toBe("bilibili");
    });
  });

  describe("convertDefinition — null-coalescing branches (label ?? null, title ?? null)", () => {
    it("handles definition with undefined label and title", () => {
      const node = {
        type: "definition",
        identifier: "ref",
        url: "https://example.com",
      } as Definition;
      const result = convertDefinition(context, node);
      expect(result).not.toBeNull();
      expect(result!.attrs.label).toBeNull();
      expect(result!.attrs.title).toBeNull();
    });
  });

  describe("convertList — start ?? 1 fallback", () => {
    it("handles ordered list with undefined start (defaults to 1)", () => {
      const node = {
        type: "list",
        ordered: true,
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [{ type: "text", value: "item" }] }] },
        ],
      } as List;
      delete (node as any).start;
      const result = convertList(context, node, []);
      expect(result).not.toBeNull();
      expect(result!.attrs.start).toBe(1);
    });
  });

  describe("convertParagraph — image url undefined (line 88 ?? fallback)", () => {
    it("falls through video/audio checks when image url is undefined", () => {
      // Schema with block_video and block_audio but NOT block_image
      // so we can verify the url ?? "" fallback path without hitting convertImage
      const schemaNoBlockImage = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: {
            content: "inline*",
            group: "block",
            attrs: { sourceLine: { default: null } },
          },
          block_video: {
            attrs: {
              src: { default: "" }, title: { default: "" },
              controls: { default: true }, preload: { default: "metadata" },
              sourceLine: { default: null },
            },
            group: "block",
            atom: true,
          },
          block_audio: {
            attrs: {
              src: { default: "" }, title: { default: "" },
              controls: { default: true }, preload: { default: "metadata" },
              sourceLine: { default: null },
            },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(schemaNoBlockImage);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: undefined as unknown as string, alt: "pic", title: null },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      // url ?? "" is "" which has neither video nor audio extension
      // no block_image in schema → falls through to normal paragraph
      expect(result!.type.name).toBe("paragraph");
    });
  });

  describe("convertParagraph — no block_image in schema (line 114 guard)", () => {
    const noBlockImageSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          content: "inline*",
          group: "block",
          attrs: { sourceLine: { default: null } },
        },
        image: {
          attrs: { src: {}, alt: { default: null }, title: { default: null } },
          inline: true,
          group: "inline",
        },
        text: { group: "inline" },
      },
    });

    it("falls through to normal paragraph when block_image not in schema", () => {
      const ctx = createContext(noBlockImageSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "photo.png", alt: "pic", title: null },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      // No block_image, block_video, or block_audio → normal paragraph
      expect(result!.type.name).toBe("paragraph");
    });
  });

  describe("convertParagraph — inline HTML value undefined (line 129 ?? fallback)", () => {
    const mediaSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          content: "inline*",
          group: "block",
          attrs: { sourceLine: { default: null } },
        },
        block_video: {
          attrs: {
            src: { default: "" }, title: { default: "" }, poster: { default: "" },
            controls: { default: true }, preload: { default: "metadata" },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        text: { group: "inline" },
      },
    });

    it("handles inline HTML child with undefined value", () => {
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "html", value: undefined as unknown as string },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      // value ?? "" is "" which doesn't match video/audio → normal paragraph
      expect(result!.type.name).toBe("paragraph");
    });
  });

  describe("convertHeading — nested phrasing children", () => {
    it("converts headings containing non-text children without error", () => {
      const ctx = createContext();
      const node: Heading = {
        type: "heading",
        depth: 2,
        children: [
          { type: "text", value: "Hello " },
          { type: "emphasis", children: [{ type: "text", value: "world" }] } as any,
        ],
      };
      const result = convertHeading(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("heading");
      // Nested phrasing text is extracted recursively for the heading ID —
      // see "includes text nested in emphasis/strong/links/inline code".
    });
  });

  describe("convertListItem — paragraph not in schema (line 206 guard)", () => {
    it("returns listItem with empty children when paragraph is missing", () => {
      const noParagraphSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          listItem: {
            attrs: { checked: { default: null }, sourceLine: { default: null } },
            content: "text*",
            group: "block",
          },
          text: {},
        },
      });
      const ctx = createContext(noParagraphSchema);
      const node: ListItem = {
        type: "listItem",
        children: [],
      };
      const result = convertListItem(ctx, node, []);
      expect(result).not.toBeNull();
      // children.length === 0 and no paragraph type → children stays empty array
      // But the function creates the node with empty children
    });
  });

  describe("convertTable — no paragraphType (line 246 guard)", () => {
    const noParagraphTableSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        table: { content: "tableRow+", group: "block" },
        tableRow: { content: "tableCell+" },
        tableCell: {
          content: "text*",
          attrs: { sourceLine: { default: null } },
        },
        text: {},
      },
    });

    it("passes inline children directly when paragraph not in schema", () => {
      const ctx = createContext(noParagraphTableSchema);
      const node: Table = {
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "cell" }] },
            ],
          },
        ],
      };
      const result = convertTable(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("table");
    });
  });

  describe("tryPromoteMediaHtml — no block_audio in schema (line 411 guard)", () => {
    const noAudioSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        html_block: {
          attrs: { value: { default: "" }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        text: { group: "inline" },
      },
    });

    it("returns null for audio tag when block_audio not in schema", () => {
      const ctx = createContext(noAudioSchema);
      const node: Html = {
        type: "html",
        value: '<audio src="song.mp3" controls></audio>',
      };
      const result = convertHtml(ctx, node, false);
      expect(result).not.toBeNull();
      // Falls through audio promotion (no block_audio), lands on html_block
      expect(result!.type.name).toBe("html_block");
    });
  });

  describe("tryPromoteMediaHtml — iframe width/height NaN fallback (lines 420-421)", () => {
    const mediaSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        video_embed: {
          attrs: {
            provider: { default: "" }, videoId: { default: "" },
            width: { default: 560 }, height: { default: 315 },
            sourceLine: { default: null },
          },
          group: "block",
          atom: true,
        },
        html_block: {
          attrs: { value: { default: "" }, sourceLine: { default: null } },
          group: "block",
          atom: true,
        },
        text: { group: "inline" },
      },
    });

    it("defaults width/height to 560/315 when parseInt returns NaN", () => {
      const ctx = createContext(mediaSchema);
      const node: Html = {
        type: "html",
        value: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="abc" height="xyz"></iframe>',
      };
      const result = convertHtml(ctx, node, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("video_embed");
      expect(result!.attrs.width).toBe(560);
      expect(result!.attrs.height).toBe(315);
    });
  });

  describe("stripAlertMarker — paragraph.children nullish (line 489)", () => {
    it("returns null when paragraph has undefined children", () => {
      const node: Blockquote = {
        type: "blockquote",
        children: [
          { type: "paragraph", children: undefined as any },
        ],
      };
      const result = convertAlertBlockquote(context, node, []);
      // paragraph.children is undefined → [...undefined] will use ?? []
      // First child is undefined → returns null
      expect(result).toBeNull();
    });
  });

  describe("convertTable — headerType fallback when tableHeader missing (line 230)", () => {
    const noHeaderSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          content: "inline*",
          group: "block",
          attrs: { sourceLine: { default: null } },
        },
        table: {
          content: "tableRow+",
          group: "block",
          attrs: { sourceLine: { default: null } },
        },
        tableRow: {
          content: "tableCell+",
          attrs: { sourceLine: { default: null } },
        },
        tableCell: {
          content: "paragraph+",
          attrs: { sourceLine: { default: null } },
        },
        text: { group: "inline" },
      },
    });

    it("uses tableCell as headerType when tableHeader not in schema", () => {
      const ctx = createContext(noHeaderSchema);
      const node: Table = {
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "header" }] },
            ],
          },
        ],
      };
      const result = convertTable(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("table");
    });
  });

  describe("convertParagraph — block_image with no inline image node (line 116 else branch)", () => {
    it("falls through to paragraph when block_image is in schema but image inline node is not (convertImage returns null)", () => {
      // Schema has block_image but NOT the inline image node type.
      // convertImage() returns null because schema.nodes.image is undefined.
      // This exercises the if (imageNode) else branch at line 116.
      const blockImageNoInlineSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: {
            content: "inline*",
            group: "block",
            attrs: { sourceLine: { default: null } },
          },
          block_image: {
            attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(blockImageNoInlineSchema);
      const node: Paragraph = {
        type: "paragraph",
        children: [
          { type: "image", url: "photo.png", alt: "a photo", title: null },
        ],
      };
      const result = convertParagraph(ctx, node, []);
      // imageNode is null → falls through block_image branch → becomes paragraph
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("paragraph");
    });
  });

  describe("convertParagraph — block_image alt null-coalescing (line 119 alt ?? '' branch)", () => {
    it("sets alt to empty string when image has no alt text (alt ?? '' fires when alt is null)", () => {
      // convertImage sets alt: node.alt || null — when node.alt is empty/absent, alt attr is null.
      // block_image creation then uses imageNode.attrs.alt ?? "" to coerce null to "".
      const mediaSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: {
            content: "inline*",
            group: "block",
            attrs: { sourceLine: { default: null } },
          },
          block_image: {
            attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          image: {
            attrs: { src: {}, alt: { default: null }, title: { default: null } },
            inline: true,
            group: "inline",
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(mediaSchema);
      const node: Paragraph = {
        type: "paragraph",
        // alt is empty string → convertImage sets alt attr to null → ?? "" fires
        children: [{ type: "image", url: "photo.png", alt: "", title: null }],
      };
      const result = convertParagraph(ctx, node, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_image");
      expect(result!.attrs.alt).toBe("");
    });
  });

  describe("tryPromoteMediaHtml — iframe without src attribute (line 411 src ?? '' branch)", () => {
    it("uses empty string when iframe has no src attribute, then exits early (no recognized provider)", () => {
      // The iframe has no src attribute at all, so attrs.src is undefined.
      // The ?? "" fallback fires, yielding "", which detectProviderFromIframeSrc cannot match.
      // The function then returns null (no provider) and falls through to html_block.
      const mediaSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { content: "inline*", group: "block" },
          video_embed: {
            attrs: { provider: { default: "" }, videoId: { default: "" }, width: { default: 560 }, height: { default: 315 }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          html_block: {
            attrs: { value: { default: "" }, sourceLine: { default: null } },
            group: "block",
            atom: true,
          },
          text: { group: "inline" },
        },
      });
      const ctx = createContext(mediaSchema);
      // Iframe with no src attribute — attrs.src will be undefined
      const node: Html = { type: "html", value: '<iframe width="640" height="360"></iframe>' };
      const result = convertHtml(ctx, node, false);
      // No src → no recognized provider → tryPromoteMediaHtml returns null → html_block
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_block");
    });
  });
});
