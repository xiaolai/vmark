/**
 * MDAST to ProseMirror inline conversion tests
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "./parser";
import { mdastToProseMirror } from "./mdastToProseMirror";
import { testSchema } from "./testSchema";

const parseDoc = (markdown: string) => mdastToProseMirror(testSchema, parseMarkdownToMdast(markdown));

describe("mdastToProseMirror inline", () => {
  it("converts basic marks", () => {
    const doc = parseDoc("**bold** *italic* ~~strike~~ `code`");
    const para = doc.firstChild;
    let foundBold = false;
    let foundItalic = false;
    let foundStrike = false;
    let foundCode = false;

    para?.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "bold")) foundBold = true;
      if (child.marks.some((m) => m.type.name === "italic")) foundItalic = true;
      if (child.marks.some((m) => m.type.name === "strike")) foundStrike = true;
      if (child.marks.some((m) => m.type.name === "code")) foundCode = true;
    });

    expect(foundBold).toBe(true);
    expect(foundItalic).toBe(true);
    expect(foundStrike).toBe(true);
    expect(foundCode).toBe(true);
  });

  it("converts inline math", () => {
    const doc = parseDoc("Formula $E=mc^2$");
    const para = doc.firstChild;
    const mathNode = para?.child(1);
    expect(mathNode?.type.name).toBe("math_inline");
  });

  it("converts custom inline marks", () => {
    const doc = parseDoc("H~2~O and x^2^ and ==hi== ++u++");
    const para = doc.firstChild;
    const hasUnderline = para?.childCount ? para?.child(para.childCount - 1).marks.some((m) => m.type.name === "underline") : false;
    expect(hasUnderline).toBe(true);
  });

  it("converts wiki links and embeds", () => {
    const doc = parseDoc("See [[Page|Alias]] and ![[embed]]");
    const para = doc.firstChild;
    const wikiLink = para?.content.content.find((child) => child.type.name === "wikiLink");
    const wikiEmbed = para?.content.content.find((child) => child.type.name === "wikiEmbed");
    expect(wikiLink).toBeDefined();
    expect(wikiEmbed).toBeDefined();
  });

  it("converts link references", () => {
    const doc = parseDoc("Link [ref][id]\n\n[id]: https://example.com");
    const para = doc.firstChild;
    const linkRef = para?.content.content.find((child) => child.type.name === "link_reference");
    expect(linkRef).toBeDefined();
  });

  it("converts inline html", () => {
    const doc = parseDoc("Text <kbd>Key</kbd>");
    const para = doc.firstChild;
    const htmlNode = para?.content.content.find((child) => child.type.name === "html_inline");
    expect(htmlNode).toBeDefined();
  });

  it("merges inline html tag pairs", () => {
    const doc = parseDoc('<span style="color: red;">Hello</span>');
    const para = doc.firstChild;
    const htmlNode = para?.content.content.find((child) => child.type.name === "html_inline");
    expect(htmlNode?.attrs.value).toContain('style="color: red;"');
    expect(htmlNode?.attrs.value).toContain("Hello");
  });

  it("converts footnote references", () => {
    // Footnote refs need matching definitions to be parsed as footnotes
    const doc = parseDoc("Hello [^1]\n\n[^1]: note");
    const para = doc.firstChild;
    const footnoteRef = para?.content.content.find((child) => child.type.name === "footnote_reference");
    expect(footnoteRef).toBeDefined();
    expect(footnoteRef?.attrs.label).toBe("1");
  });
});
