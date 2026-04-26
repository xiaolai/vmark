/**
 * ProseMirror to MDAST inline conversion tests
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

describe("proseMirrorToMdast inline", () => {
  it("serializes wiki links", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("wikiLink", { value: "Page" }, [testSchema.text("Alias")]),
      ]),
    ]);

    expect(md).toContain("[[Page|Alias]]");
  });

  it("serializes inline html", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("Key "),
        testSchema.node("html_inline", { value: "<kbd>X</kbd>" }),
      ]),
    ]);

    expect(md).toContain("<kbd>X</kbd>");
  });

  it("serializes underline marks", () => {
    const underline = testSchema.mark("underline");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("underlined", [underline]),
      ]),
    ]);

    expect(md).toContain("++underlined++");
  });

  it("serializes footnote references", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("Hello "),
        testSchema.node("footnote_reference", { label: "1" }),
      ]),
    ]);

    expect(md).toContain("[^1]");
  });

  it("wraps URLs with spaces in angle brackets", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("image", {
          src: "/path/with spaces/image file.png",
          alt: "alt text",
        }),
      ]),
    ]);

    // URLs with spaces should use angle bracket syntax (CommonMark standard)
    expect(md).toContain("</path/with spaces/image file.png>");
  });

  it("wraps link URLs with spaces in angle brackets", () => {
    const link = testSchema.mark("link", { href: "/path/with spaces/doc.md" });
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [testSchema.text("link text", [link])]),
    ]);

    // URLs with spaces should use angle bracket syntax
    expect(md).toContain("</path/with spaces/doc.md>");
  });

  it("serializes wiki links without alias (alias equals value)", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("wikiLink", { value: "Page" }, [testSchema.text("Page")]),
      ]),
    ]);

    // When alias equals value, no pipe alias in output
    expect(md).toContain("[[Page]]");
    expect(md).not.toContain("|");
  });

  it("serializes wiki links with empty content", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("wikiLink", { value: "EmptyPage" }),
      ]),
    ]);

    expect(md).toContain("[[EmptyPage]]");
  });

  it("serializes hard breaks", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("Line 1"),
        testSchema.node("hardBreak"),
        testSchema.text("Line 2"),
      ]),
    ]);

    expect(md).toContain("Line 1");
    expect(md).toContain("Line 2");
  });

  it("serializes images without title", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("image", { src: "img.png", alt: "alt" }),
      ]),
    ]);

    expect(md).toContain("![alt](img.png)");
  });

  it("serializes inline math", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("Formula "),
        testSchema.node("math_inline", { content: "E=mc^2" }),
      ]),
    ]);

    expect(md).toContain("$E=mc^2$");
  });

  it("serializes bold text", () => {
    const bold = testSchema.mark("bold");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("bold text", [bold]),
      ]),
    ]);

    expect(md).toContain("**bold text**");
  });

  it("serializes italic text", () => {
    const italic = testSchema.mark("italic");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("italic text", [italic]),
      ]),
    ]);

    expect(md).toContain("*italic text*");
  });

  it("serializes strikethrough text", () => {
    const strike = testSchema.mark("strike");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("deleted", [strike]),
      ]),
    ]);

    expect(md).toContain("~~deleted~~");
  });

  it("serializes inline code", () => {
    const code = testSchema.mark("code");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("x = 1", [code]),
      ]),
    ]);

    expect(md).toContain("`x = 1`");
  });

  it("serializes subscript text", () => {
    const sub = testSchema.mark("subscript");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("H"),
        testSchema.text("2", [sub]),
        testSchema.text("O"),
      ]),
    ]);

    expect(md).toContain("~2~");
  });

  it("serializes superscript text", () => {
    const sup = testSchema.mark("superscript");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("x"),
        testSchema.text("2", [sup]),
      ]),
    ]);

    expect(md).toContain("^2^");
  });

  it("serializes highlight text", () => {
    const highlight = testSchema.mark("highlight");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("marked", [highlight]),
      ]),
    ]);

    expect(md).toContain("==marked==");
  });

  it("serializes nested marks (bold + italic)", () => {
    const bold = testSchema.mark("bold");
    const italic = testSchema.mark("italic");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("both", [bold, italic]),
      ]),
    ]);

    // Should contain both bold and italic markers
    expect(md).toMatch(/\*{3}both\*{3}|\*\*\*both\*\*\*/);
  });

  it("serializes text carrying both link and code marks as `[\\`code\\`](url)`", () => {
    // Regression: PM text with both code and link marks — produced by
    // mdastToProseMirror for `[\`text\`](url)` markdown — must round-trip,
    // not collapse to empty backticks.
    const link = testSchema.mark("link", { href: "./LICENSE" });
    const code = testSchema.mark("code");
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.text("ISC License. See "),
        testSchema.text("LICENSE", [link, code]),
        testSchema.text("."),
      ]),
    ]);

    expect(md).toContain("[`LICENSE`](./LICENSE)");
    expect(md).not.toContain("``");
  });

  it("serializes text with code and link marks regardless of mark order", () => {
    // ProseMirror canonicalizes mark order based on schema rank, so the
    // PM-stored order may put link first or code first. Both must serialize
    // correctly: code mark must always become the innermost MDAST node.
    const link = testSchema.mark("link", { href: "https://example.com" });
    const code = testSchema.mark("code");

    const codeFirst = pmToMarkdown([
      testSchema.node("paragraph", null, [testSchema.text("ref", [code, link])]),
    ]);
    const linkFirst = pmToMarkdown([
      testSchema.node("paragraph", null, [testSchema.text("ref", [link, code])]),
    ]);

    expect(codeFirst).toContain("[`ref`](https://example.com)");
    expect(linkFirst).toContain("[`ref`](https://example.com)");
  });

  it("serializes footnote_definition with null label — falls back to '1' (L225/226)", () => {
    // L225/226: identifier/label uses `node.attrs.label ?? "1"` when label is null
    const doc = testSchema.node("doc", null, [
      testSchema.node("footnote_definition", { label: null }, [
        testSchema.node("paragraph", null, [testSchema.text("note content")]),
      ]),
    ]);
    const mdast = proseMirrorToMdast(testSchema, doc);
    const footnote = mdast.children.find((c) => c.type === "footnoteDefinition") as
      | { type: string; identifier: string; label: string }
      | undefined;
    expect(footnote).toBeDefined();
    expect(footnote!.identifier).toBe("1");
    expect(footnote!.label).toBe("1");
  });

  it("serializes wikiLink with null value attribute — falls back to empty string (L238)", () => {
    // L238: value uses `node.attrs.value ?? ""` when value is null
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("wikiLink", { value: null }),
      ]),
    ]);
    // Should produce a wiki link with empty target (no crash)
    expect(md).toContain("[[]]");
  });

  it("serializes html_inline with null value attribute — falls back to empty string (L249)", () => {
    // L249: value uses `node.attrs.value ?? ""` when value is null
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("html_inline", { value: null }),
      ]),
    ]);
    // Should produce empty html inline (no crash)
    expect(md).toBeDefined();
  });
});
