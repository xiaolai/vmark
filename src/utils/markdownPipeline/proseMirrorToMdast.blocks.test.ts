// @vitest-environment node
/**
 * ProseMirror to MDAST block conversion tests
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { proseMirrorToMdast } from "./proseMirrorToMdast";
import { serializeMdastToMarkdown } from "./serializer";
import { testSchema } from "./testSchema";

const pmToMarkdown = (children: ReturnType<typeof testSchema.node>[]) => {
  const doc = testSchema.node("doc", null, children);
  const mdast = proseMirrorToMdast(testSchema, doc);
  return serializeMdastToMarkdown(mdast);
};

describe("proseMirrorToMdast blocks", () => {
  it("serializes block math from code blocks with math sentinel", () => {
    // Use the $$math$$ sentinel value to identify math blocks
    const md = pmToMarkdown([
      testSchema.node("codeBlock", { language: "$$math$$" }, [
        testSchema.text("x^2 + y^2 = z^2"),
      ]),
    ]);

    expect(md).toContain("$$");
    expect(md).toContain("x^2 + y^2 = z^2");
  });

  it("preserves real latex code fences (not math)", () => {
    // Real latex code fences should NOT be converted to math blocks
    const md = pmToMarkdown([
      testSchema.node("codeBlock", { language: "latex" }, [
        testSchema.text("\\documentclass{article}"),
      ]),
    ]);

    expect(md).toContain("```latex");
    expect(md).toContain("\\documentclass{article}");
    expect(md).not.toContain("$$");
  });

  it("serializes alert blocks", () => {
    const md = pmToMarkdown([
      testSchema.node("alertBlock", { alertType: "TIP" }, [
        testSchema.node("paragraph", null, [testSchema.text("Heads up")]),
      ]),
    ]);

    expect(md).toContain("[!TIP]");
    expect(md).toContain("Heads up");
  });

  it("serializes details blocks", () => {
    const md = pmToMarkdown([
      testSchema.node("detailsBlock", { open: true }, [
        testSchema.node("detailsSummary", null, [testSchema.text("More")]),
        testSchema.node("paragraph", null, [testSchema.text("Hidden")]),
      ]),
    ]);

    expect(md).toContain("<details");
    expect(md).toContain("<summary>More</summary>");
    expect(md).toContain("Hidden");
  });

  it("serializes tables with alignment", () => {
    const md = pmToMarkdown([
      testSchema.node("table", null, [
        testSchema.node("tableRow", null, [
          testSchema.node("tableHeader", { alignment: "left" }, [
            testSchema.node("paragraph", null, [testSchema.text("A")]),
          ]),
          testSchema.node("tableHeader", { alignment: "center" }, [
            testSchema.node("paragraph", null, [testSchema.text("B")]),
          ]),
          testSchema.node("tableHeader", { alignment: "right" }, [
            testSchema.node("paragraph", null, [testSchema.text("C")]),
          ]),
        ]),
        testSchema.node("tableRow", null, [
          testSchema.node("tableCell", null, [
            testSchema.node("paragraph", null, [testSchema.text("1")]),
          ]),
          testSchema.node("tableCell", null, [
            testSchema.node("paragraph", null, [testSchema.text("2")]),
          ]),
          testSchema.node("tableCell", null, [
            testSchema.node("paragraph", null, [testSchema.text("3")]),
          ]),
        ]),
      ]),
    ]);

    expect(md).toMatch(/\|\s*:-+\s*\|/);
    expect(md).toMatch(/\|\s*:-+:\s*\|/);
    expect(md).toMatch(/\|\s*-+:\s*\|/);
  });

  it("serializes frontmatter", () => {
    const md = pmToMarkdown([
      testSchema.node("frontmatter", { value: "title: Test" }),
      testSchema.node("paragraph", null, [testSchema.text("Body")]),
    ]);

    expect(md).toContain("---");
    expect(md).toContain("title: Test");
  });

  it("serializes link definitions", () => {
    const md = pmToMarkdown([
      testSchema.node("link_definition", {
        identifier: "ref",
        url: "https://example.com",
        title: "Title",
      }),
    ]);

    expect(md).toContain("[ref]: https://example.com");
  });

  it("serializes html blocks", () => {
    const md = pmToMarkdown([
      testSchema.node("html_block", { value: "<div>Raw</div>" }),
    ]);

    expect(md).toContain("<div>Raw</div>");
  });

  it("serializes block images", () => {
    const md = pmToMarkdown([
      testSchema.node("block_image", { src: "image.png", alt: "alt", title: "" }),
    ]);

    expect(md).toContain("![alt](image.png)");
  });

  it("serializes block images with spaces in path using angle brackets", () => {
    const md = pmToMarkdown([
      testSchema.node("block_image", {
        src: "/Users/test/My Screenshots/Screenshot 2026-01-19.png",
        alt: "screenshot",
      }),
    ]);

    // URLs with spaces should use angle bracket syntax (CommonMark standard)
    expect(md).toContain("</Users/test/My Screenshots/Screenshot 2026-01-19.png>");
  });

  it("serializes footnote definitions", () => {
    const md = pmToMarkdown([
      testSchema.node("footnote_definition", { label: "1" }, [
        testSchema.node("paragraph", null, [testSchema.text("Footnote content")]),
      ]),
    ]);

    expect(md).toContain("[^1]:");
    expect(md).toContain("Footnote content");
  });

  it("serializes blockquotes", () => {
    const md = pmToMarkdown([
      testSchema.node("blockquote", null, [
        testSchema.node("paragraph", null, [testSchema.text("quoted")]),
      ]),
    ]);

    expect(md).toContain("> quoted");
  });

  it("serializes bullet lists", () => {
    const md = pmToMarkdown([
      testSchema.node("bulletList", null, [
        testSchema.node("listItem", null, [
          testSchema.node("paragraph", null, [testSchema.text("item 1")]),
        ]),
        testSchema.node("listItem", null, [
          testSchema.node("paragraph", null, [testSchema.text("item 2")]),
        ]),
      ]),
    ]);

    expect(md).toContain("- item 1");
    expect(md).toContain("- item 2");
  });

  it("serializes ordered lists with start", () => {
    const md = pmToMarkdown([
      testSchema.node("orderedList", { start: 3 }, [
        testSchema.node("listItem", null, [
          testSchema.node("paragraph", null, [testSchema.text("third")]),
        ]),
      ]),
    ]);

    expect(md).toContain("3.");
    expect(md).toContain("third");
  });

  it("serializes task list items", () => {
    const md = pmToMarkdown([
      testSchema.node("bulletList", null, [
        testSchema.node("listItem", { checked: false }, [
          testSchema.node("paragraph", null, [testSchema.text("todo")]),
        ]),
        testSchema.node("listItem", { checked: true }, [
          testSchema.node("paragraph", null, [testSchema.text("done")]),
        ]),
      ]),
    ]);

    expect(md).toContain("[ ] todo");
    expect(md).toContain("[x] done");
  });

  it("serializes horizontal rule", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [testSchema.text("before")]),
      testSchema.node("horizontalRule"),
      testSchema.node("paragraph", null, [testSchema.text("after")]),
    ]);

    expect(md).toContain("---");
  });

  it("serializes code blocks without language", () => {
    const md = pmToMarkdown([
      testSchema.node("codeBlock", { language: null }, [
        testSchema.text("plain code"),
      ]),
    ]);

    expect(md).toContain("```");
    expect(md).toContain("plain code");
  });

  it("serializes details block without summary node", () => {
    // When first child is NOT detailsSummary, should use "Details" as default
    const md = pmToMarkdown([
      testSchema.node("detailsBlock", { open: false }, [
        testSchema.node("detailsSummary", null, [testSchema.text("Custom")]),
        testSchema.node("paragraph", null, [testSchema.text("Body")]),
      ]),
    ]);

    expect(md).toContain("<summary>Custom</summary>");
    expect(md).toContain("Body");
  });

  it("serializes a listItem with no children as empty bullet (not ## heading)", () => {
    // A listItem with 0 children is structurally invalid but can occur
    // from certain markdown parsers. The serializer must not produce garbage.
    const looseSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { inline: true, group: "inline" },
        bulletList: { content: "listItem+", group: "block" },
        listItem: { content: "block*" }, // allows 0 children for this test
      },
    });
    const doc = looseSchema.node("doc", null, [
      looseSchema.node("bulletList", null, [
        looseSchema.node("listItem", null, [
          looseSchema.node("paragraph", null, [looseSchema.text("has text")]),
        ]),
        looseSchema.node("listItem", null, []), // 0 children
      ]),
    ]);

    const mdast = proseMirrorToMdast(looseSchema, doc);
    const md = serializeMdastToMarkdown(mdast);

    expect(md).toContain("has text");
    expect(md).not.toContain("##");
    // Should produce two list items (two dashes at line start)
    const dashes = md.match(/^-/gm);
    expect(dashes).toHaveLength(2);
  });
});
