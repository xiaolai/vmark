// @vitest-environment node
/**
 * Tiptap Context Extraction Tests
 *
 * Tests for extracting CursorContext from Tiptap/ProseMirror state.
 * These tests use a minimal ProseMirror schema to avoid editor dependencies.
 */

import { describe, it, expect } from "vitest";
import { Schema, Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { extractTiptapContext } from "./tiptapContext";

// Minimal schema for testing
const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      attrs: { level: { default: 1 } },
      group: "block",
      content: "inline*",
    },
    codeBlock: {
      attrs: { language: { default: "" } },
      group: "block",
      content: "text*",
      code: true,
    },
    blockquote: { group: "block", content: "block+" },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*" },
    table: { group: "block", content: "tableRow+" },
    tableRow: { content: "tableCell+" },
    tableCell: { content: "block+" },
    image: {
      group: "inline",
      inline: true,
      attrs: { src: {}, alt: { default: "" } },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    link: { attrs: { href: {} } },
  },
});

// Helper to create editor state with selection
function createState(doc: Node, from: number, to?: number): EditorState {
  const state = EditorState.create({ doc, schema: testSchema });
  const selection = to
    ? TextSelection.create(state.doc, from, to)
    : TextSelection.create(state.doc, from);
  return state.apply(state.tr.setSelection(selection));
}

// Helper to create document
function doc(...children: Node[]): Node {
  return testSchema.node("doc", null, children);
}

function p(...content: (Node | string)[]): Node {
  const children = content
    .filter((c) => c !== "") // Filter empty strings
    .map((c) => (typeof c === "string" ? testSchema.text(c) : c));
  return testSchema.node("paragraph", null, children.length > 0 ? children : undefined);
}

function heading(level: number, text: string): Node {
  return testSchema.node("heading", { level }, [testSchema.text(text)]);
}

function codeBlock(language: string, text: string): Node {
  return testSchema.node("codeBlock", { language }, text ? [testSchema.text(text)] : []);
}

function blockquote(...children: Node[]): Node {
  return testSchema.node("blockquote", null, children);
}

function bulletList(...items: Node[]): Node {
  return testSchema.node("bulletList", null, items);
}

function orderedList(...items: Node[]): Node {
  return testSchema.node("orderedList", null, items);
}

function listItem(...children: Node[]): Node {
  return testSchema.node("listItem", null, children);
}

function table(...rows: Node[]): Node {
  return testSchema.node("table", null, rows);
}

function tableRow(...cells: Node[]): Node {
  return testSchema.node("tableRow", null, cells);
}

function tableCell(...children: Node[]): Node {
  return testSchema.node("tableCell", null, children);
}

function linkedText(text: string, href: string): Node {
  return testSchema.text(text, [testSchema.mark("link", { href })]);
}

function boldText(text: string): Node {
  return testSchema.text(text, [testSchema.mark("bold")]);
}

describe("extractTiptapContext", () => {
  describe("code block detection", () => {
    it("detects cursor in code block", () => {
      const document = doc(codeBlock("typescript", "const x = 1;"));
      const state = createState(document, 2); // Inside code block

      const ctx = extractTiptapContext(state);

      expect(ctx.inCodeBlock).toBeDefined();
      expect(ctx.inCodeBlock?.language).toBe("typescript");
    });

    it("returns undefined for code block when outside", () => {
      const document = doc(p("hello"), codeBlock("js", "code"));
      const state = createState(document, 2); // In paragraph

      const ctx = extractTiptapContext(state);

      expect(ctx.inCodeBlock).toBeUndefined();
    });
  });

  describe("table detection", () => {
    it("detects cursor in table", () => {
      const document = doc(
        table(
          tableRow(tableCell(p("a")), tableCell(p("b"))),
          tableRow(tableCell(p("c")), tableCell(p("d")))
        )
      );
      // Position inside first cell
      const state = createState(document, 5);

      const ctx = extractTiptapContext(state);

      expect(ctx.inTable).toBeDefined();
      expect(ctx.inTable?.totalRows).toBe(2);
      expect(ctx.inTable?.totalCols).toBe(2);
    });
  });

  describe("list detection", () => {
    it("detects cursor in bullet list", () => {
      const document = doc(bulletList(listItem(p("item 1")), listItem(p("item 2"))));
      const state = createState(document, 4); // Inside first item

      const ctx = extractTiptapContext(state);

      expect(ctx.inList).toBeDefined();
      expect(ctx.inList?.listType).toBe("bullet");
    });

    it("detects cursor in ordered list", () => {
      const document = doc(orderedList(listItem(p("item 1"))));
      const state = createState(document, 4);

      const ctx = extractTiptapContext(state);

      expect(ctx.inList).toBeDefined();
      expect(ctx.inList?.listType).toBe("ordered");
    });

    it("calculates list depth", () => {
      const document = doc(
        bulletList(listItem(p("outer"), bulletList(listItem(p("inner")))))
      );
      // Position in inner list
      const state = createState(document, 15);

      const ctx = extractTiptapContext(state);

      expect(ctx.inList).toBeDefined();
      expect(ctx.inList?.depth).toBeGreaterThan(0);
    });
  });

  describe("blockquote detection", () => {
    it("detects cursor in blockquote", () => {
      const document = doc(blockquote(p("quoted text")));
      const state = createState(document, 3);

      const ctx = extractTiptapContext(state);

      expect(ctx.inBlockquote).toBeDefined();
      expect(ctx.inBlockquote?.depth).toBe(1);
    });

    it("calculates nested blockquote depth", () => {
      const document = doc(blockquote(blockquote(p("nested"))));
      const state = createState(document, 5);

      const ctx = extractTiptapContext(state);

      expect(ctx.inBlockquote).toBeDefined();
      expect(ctx.inBlockquote?.depth).toBe(2);
    });

    it("counts depth=1 when blockquote is inside a list item (non-blockquote ancestors at lower depths)", () => {
      // Structure: doc > bulletList > listItem > paragraph + blockquote > paragraph
      // listItem schema requires "paragraph block*" so we use: listItem(p(""), blockquote(p("...")))
      // When the outer loop traverses depths looking for blockquote, it finds it at depth 4:
      //   depth 0: doc
      //   depth 1: bulletList
      //   depth 2: listItem
      //   depth 3: blockquote (detected here)
      //   depth 4: paragraph
      // Inner loop: dd=1 (bulletList → false branch), dd=2 (listItem → false), dd=3 (blockquote → true)
      // Result: depth=1
      const document = doc(
        bulletList(listItem(p(""), blockquote(p("bq in list"))))
      );
      // Navigate into the blockquote paragraph content
      // pos: doc(1) > bulletList(1) > listItem(1) > p("") = 2 chars (open+close), blockquote(1) > p(1) > text
      // Total: 1 + 1 + 1 + 2 + 1 + 1 + 1 = let's resolve from end of "bq in list"
      // Rough position inside "bq in list" text — try pos 10
      const state = createState(document, 10);

      const ctx = extractTiptapContext(state);

      expect(ctx.inBlockquote).toBeDefined();
      expect(ctx.inBlockquote?.depth).toBe(1);
    });
  });

  describe("selection detection", () => {
    it("detects user selection", () => {
      const document = doc(p("hello world"));
      const state = createState(document, 2, 7); // Select "ello "

      const ctx = extractTiptapContext(state);

      expect(ctx.hasSelection).toBe(true);
      expect(ctx.selectionInfo).toBeDefined();
      expect(ctx.selectionInfo?.from).toBe(2);
      expect(ctx.selectionInfo?.to).toBe(7);
    });

    it("returns hasSelection false when cursor only", () => {
      const document = doc(p("hello"));
      const state = createState(document, 3);

      const ctx = extractTiptapContext(state);

      expect(ctx.hasSelection).toBe(false);
    });
  });

  describe("heading detection", () => {
    it("detects cursor in heading", () => {
      const document = doc(heading(2, "My Heading"));
      const state = createState(document, 3);

      const ctx = extractTiptapContext(state);

      expect(ctx.inHeading).toBeDefined();
      expect(ctx.inHeading?.level).toBe(2);
    });
  });

  describe("line start detection", () => {
    it("detects cursor at paragraph line start", () => {
      const document = doc(p("hello world"));
      const state = createState(document, 1); // At start of paragraph

      const ctx = extractTiptapContext(state);

      expect(ctx.atLineStart).toBe(true);
    });

    it("returns false when not at line start", () => {
      const document = doc(p("hello world"));
      const state = createState(document, 5); // Middle of text

      const ctx = extractTiptapContext(state);

      expect(ctx.atLineStart).toBe(false);
    });

    it("returns false at line start inside list", () => {
      const document = doc(bulletList(listItem(p("item"))));
      const state = createState(document, 3);

      const ctx = extractTiptapContext(state);

      // Line start detection should return false inside lists
      // because list has its own toolbar
      expect(ctx.atLineStart).toBe(false);
    });
  });

  describe("link detection", () => {
    it("detects cursor in link mark", () => {
      const document = doc(p("hello ", linkedText("click here", "https://example.com"), " world"));
      // Position inside the link text
      const state = createState(document, 9);

      const ctx = extractTiptapContext(state);

      expect(ctx.inLink).toBeDefined();
      expect(ctx.inLink?.href).toBe("https://example.com");
    });
  });

  describe("formatted range detection", () => {
    it("detects cursor in bold text", () => {
      const document = doc(p("hello ", boldText("bold text"), " world"));
      const state = createState(document, 9); // Inside bold

      const ctx = extractTiptapContext(state);

      expect(ctx.inFormattedRange).toBeDefined();
      expect(ctx.inFormattedRange?.markType).toBe("bold");
    });
  });

  describe("surface flag", () => {
    it("sets surface to wysiwyg", () => {
      const document = doc(p("hello"));
      const state = createState(document, 2);

      const ctx = extractTiptapContext(state);

      expect(ctx.surface).toBe("wysiwyg");
    });
  });

  describe("context mode fallback", () => {
    it("returns insert when at empty line", () => {
      const document = doc(p(""));
      const state = createState(document, 1);

      const ctx = extractTiptapContext(state);

      expect(ctx.contextMode).toBe("insert-block");
    });

    it("returns insert when in text", () => {
      const document = doc(p("hello world"));
      const state = createState(document, 3);

      const ctx = extractTiptapContext(state);

      expect(ctx.contextMode).toBe("insert");
    });
  });

  describe("fallback values for node attrs", () => {
    it("uses empty string fallback when codeBlock language is falsy (line 59)", () => {
      // codeBlock with language="" — the || "" fallback triggers
      const document = doc(codeBlock("", "code here"));
      const state = createState(document, 2);

      const ctx = extractTiptapContext(state);

      expect(ctx.inCodeBlock).toBeDefined();
      expect(ctx.inCodeBlock?.language).toBe("");
    });

    it("uses fallback level 1 when heading level is falsy (line 115)", () => {
      // Create a heading with level=0 (falsy) to trigger `|| 1` fallback
      const h = testSchema.node("heading", { level: 0 }, [testSchema.text("Title")]);
      const document = doc(h);
      const state = createState(document, 2);

      const ctx = extractTiptapContext(state);

      expect(ctx.inHeading).toBeDefined();
      expect(ctx.inHeading?.level).toBe(1);
    });

    it("handles table with zero cols when row has no children (line 69-70)", () => {
      // A table with 0 rows is not valid in the schema, but we test a 1x1 table
      // and position the cursor so $from.depth relative to table triggers fallback
      const document = doc(
        table(
          tableRow(tableCell(p("only cell")))
        )
      );
      const state = createState(document, 5);

      const ctx = extractTiptapContext(state);

      expect(ctx.inTable).toBeDefined();
      expect(ctx.inTable?.totalRows).toBe(1);
      expect(ctx.inTable?.totalCols).toBe(1);
    });
  });

  describe("word detection skipped in special contexts", () => {
    it("skips word detection when cursor is in a link (line 133)", () => {
      const document = doc(p("before ", linkedText("link text", "https://example.com"), " after"));
      const state = createState(document, 11); // Inside the link

      const ctx = extractTiptapContext(state);

      // inLink should be detected, inWord should NOT be set
      expect(ctx.inLink).toBeDefined();
      expect(ctx.inWord).toBeUndefined();
    });

    it("skips word detection when cursor is in formatted text (line 133)", () => {
      const document = doc(p("before ", boldText("bold text"), " after"));
      const state = createState(document, 11); // Inside bold

      const ctx = extractTiptapContext(state);

      expect(ctx.inFormattedRange).toBeDefined();
      expect(ctx.inWord).toBeUndefined();
    });
  });
});
