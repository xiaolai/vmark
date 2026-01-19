/**
 * ProseMirror to MDAST block conversion tests
 */

import { describe, it, expect } from "vitest";
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
});
