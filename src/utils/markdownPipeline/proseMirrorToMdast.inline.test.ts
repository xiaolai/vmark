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
  it("serializes wiki links and embeds", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("wikiLink", { value: "Page", alias: "Alias" }),
        testSchema.text(" "),
        testSchema.node("wikiEmbed", { value: "embed" }),
      ]),
    ]);

    expect(md).toContain("[[Page|Alias]]");
    expect(md).toContain("![[embed]]");
  });

  it("serializes link references", () => {
    const md = pmToMarkdown([
      testSchema.node("paragraph", null, [
        testSchema.node("link_reference", { identifier: "ref" }, [
          testSchema.text("Link"),
        ]),
      ]),
      testSchema.node("link_definition", {
        identifier: "ref",
        url: "https://example.com",
      }),
    ]);

    expect(md).toContain("[Link][ref]");
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
});
