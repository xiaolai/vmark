/**
 * MDAST to ProseMirror block conversion tests
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "./parser";
import { mdastToProseMirror } from "./mdastToProseMirror";
import { testSchema } from "./testSchema";

const parseDoc = (markdown: string) => mdastToProseMirror(testSchema, parseMarkdownToMdast(markdown));

describe("mdastToProseMirror blocks", () => {
  it("converts paragraphs and headings", () => {
    const doc = parseDoc("# Title\n\nBody");
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(1).type.name).toBe("paragraph");
  });

  it("converts code blocks", () => {
    const doc = parseDoc("```js\nconst x = 1;\n```");
    expect(doc.firstChild?.type.name).toBe("codeBlock");
    expect(doc.firstChild?.attrs.language).toBe("js");
  });

  it("converts lists and task items", () => {
    const doc = parseDoc("- [ ] Todo\n- [x] Done");
    const list = doc.firstChild;
    expect(list?.type.name).toBe("bulletList");
    expect(list?.child(0).attrs.checked).toBe(false);
    expect(list?.child(1).attrs.checked).toBe(true);
  });

  it("converts tables with alignment", () => {
    const md = `| A | B | C |
| :-- | :-: | --: |
| 1 | 2 | 3 |`;
    const doc = parseDoc(md);
    const table = doc.firstChild;
    expect(table?.type.name).toBe("table");
    const headerRow = table?.firstChild;
    const firstCell = headerRow?.firstChild;
    const secondCell = headerRow?.child(1);
    const thirdCell = headerRow?.child(2);
    expect(firstCell?.attrs.alignment).toBe("left");
    expect(secondCell?.attrs.alignment).toBe("center");
    expect(thirdCell?.attrs.alignment).toBe("right");
  });

  it("converts block math to code blocks with math sentinel", () => {
    const doc = parseDoc("$$\nx^2 + y^2 = z^2\n$$");
    expect(doc.firstChild?.type.name).toBe("codeBlock");
    // Uses sentinel value to distinguish from real latex code fences
    expect(doc.firstChild?.attrs.language).toBe("$$math$$");
  });

  it("converts alert blocks", () => {
    const doc = parseDoc("> [!NOTE]\n> Callout");
    expect(doc.firstChild?.type.name).toBe("alertBlock");
    expect(doc.firstChild?.attrs.alertType).toBe("NOTE");
  });

  it("converts details blocks", () => {
    const doc = parseDoc("<details>\n<summary>Info</summary>\n\nContent\n</details>");
    const details = doc.firstChild;
    expect(details?.type.name).toBe("detailsBlock");
    expect(details?.firstChild?.type.name).toBe("detailsSummary");
  });

  it("converts frontmatter", () => {
    const doc = parseDoc("---\ntitle: Test\n---\n\nBody");
    expect(doc.firstChild?.type.name).toBe("frontmatter");
  });

  it("converts link definitions", () => {
    const doc = parseDoc("[ref]: https://example.com");
    const def = doc.firstChild;
    expect(def?.type.name).toBe("link_definition");
    expect(def?.attrs.url).toBe("https://example.com");
  });

  it("converts html blocks", () => {
    const doc = parseDoc("<div>Raw</div>");
    expect(doc.firstChild?.type.name).toBe("html_block");
  });

  it("converts standalone images to block images", () => {
    const doc = parseDoc("![alt](image.png)");
    expect(doc.firstChild?.type.name).toBe("block_image");
  });

  it("converts footnote definitions", () => {
    const doc = parseDoc("[^1]: This is a footnote");
    expect(doc.firstChild?.type.name).toBe("footnote_definition");
    expect(doc.firstChild?.attrs.label).toBe("1");
  });
});
