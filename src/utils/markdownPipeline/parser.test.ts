/**
 * Parser tests for remark-based markdown pipeline
 *
 * Tests parseMarkdownToMdast function for CommonMark + GFM support.
 * TDD: Write tests first, then implement.
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "./parser";
import type { Paragraph, Text, Heading, Code, Link, Image } from "mdast";

describe("parseMarkdownToMdast", () => {
  describe("CommonMark basics", () => {
    it("parses a simple paragraph", () => {
      const result = parseMarkdownToMdast("Hello world");
      expect(result.type).toBe("root");
      expect(result.children).toHaveLength(1);

      const para = result.children[0] as Paragraph;
      expect(para.type).toBe("paragraph");

      const text = para.children[0] as Text;
      expect(text.type).toBe("text");
      expect(text.value).toBe("Hello world");
    });

    it("parses headings", () => {
      const result = parseMarkdownToMdast("# Heading 1\n\n## Heading 2");
      expect(result.children).toHaveLength(2);

      const h1 = result.children[0] as Heading;
      expect(h1.type).toBe("heading");
      expect(h1.depth).toBe(1);

      const h2 = result.children[1] as Heading;
      expect(h2.type).toBe("heading");
      expect(h2.depth).toBe(2);
    });

    it("parses code fences", () => {
      const result = parseMarkdownToMdast("```js\nconst x = 1;\n```");
      expect(result.children).toHaveLength(1);

      const code = result.children[0] as Code;
      expect(code.type).toBe("code");
      expect(code.lang).toBe("js");
      expect(code.value).toBe("const x = 1;");
    });

    it("parses blockquotes", () => {
      const result = parseMarkdownToMdast("> Quote text");
      expect(result.children).toHaveLength(1);
      expect(result.children[0].type).toBe("blockquote");
    });

    it("parses thematic breaks", () => {
      const result = parseMarkdownToMdast("---");
      expect(result.children).toHaveLength(1);
      expect(result.children[0].type).toBe("thematicBreak");
    });
  });

  describe("GFM extensions", () => {
    it("parses strikethrough", () => {
      const result = parseMarkdownToMdast("~~deleted~~");
      const para = result.children[0] as Paragraph;
      expect(para.children[0].type).toBe("delete");
    });

    it("parses tables", () => {
      const md = `| A | B |
| --- | --- |
| 1 | 2 |`;
      const result = parseMarkdownToMdast(md);
      expect(result.children[0].type).toBe("table");
    });

    it("parses task lists", () => {
      const md = `- [ ] unchecked
- [x] checked`;
      const result = parseMarkdownToMdast(md);
      expect(result.children[0].type).toBe("list");
    });

    it("parses autolinks", () => {
      const result = parseMarkdownToMdast("Visit https://example.com");
      const para = result.children[0] as Paragraph;
      // GFM autolinks become link nodes
      const hasLink = para.children.some((c) => c.type === "link");
      expect(hasLink).toBe(true);
    });
  });

  describe("frontmatter", () => {
    it("parses YAML frontmatter", () => {
      const md = `---
title: Test
---

Content`;
      const result = parseMarkdownToMdast(md);
      // Frontmatter should be a yaml node
      expect(result.children[0].type).toBe("yaml");
    });
  });

  describe("math (remark-math)", () => {
    it("parses inline math", () => {
      const result = parseMarkdownToMdast("Equation: $E = mc^2$");
      const para = result.children[0] as Paragraph;
      const hasMath = para.children.some((c) => c.type === "inlineMath");
      expect(hasMath).toBe(true);
    });

    it("parses block math", () => {
      const result = parseMarkdownToMdast("$$\nx^2 + y^2 = z^2\n$$");
      const hasMath = result.children.some((c) => c.type === "math");
      expect(hasMath).toBe(true);
    });

    it("rejects invalid inline math with trailing space", () => {
      // $100 and $200 should NOT be parsed as math
      // remark-math incorrectly parses this as $100 and $ being math
      const result = parseMarkdownToMdast("$100 and $200");
      const para = result.children[0] as Paragraph;
      const hasMath = para.children.some((c) => c.type === "inlineMath");
      expect(hasMath).toBe(false);
    });

    it("single dollar sign is not math", () => {
      const result = parseMarkdownToMdast("$100");
      const para = result.children[0] as Paragraph;
      const hasMath = para.children.some((c) => c.type === "inlineMath");
      expect(hasMath).toBe(false);
    });
  });

  describe("wiki links", () => {
    it("parses wiki links", () => {
      const result = parseMarkdownToMdast("See [[Page|Alias]]");
      const para = result.children[0] as Paragraph;
      const hasWikiLink = para.children.some((c) => c.type === "wikiLink");
      expect(hasWikiLink).toBe(true);
    });

    it("does not parse wiki embeds", () => {
      const result = parseMarkdownToMdast("See ![[embed]]");
      const para = result.children[0] as Paragraph;
      // Wiki embeds are no longer supported - the syntax is preserved as text
      const hasWikiLink = para.children.some((c) => c.type === "wikiLink");
      expect(hasWikiLink).toBe(false);
    });
  });

  describe("details blocks", () => {
    it("parses details HTML into details nodes", () => {
      const md = "<details>\\n<summary>Info</summary>\\n\\nBody\\n</details>";
      const result = parseMarkdownToMdast(md);
      expect(result.children[0]?.type).toBe("details");
    });
  });

  describe("reference-style links", () => {
    it("resolves linkReference to link using definition", () => {
      const md = `[Example][ex]

[ex]: https://example.com "Example Title"`;
      const result = parseMarkdownToMdast(md);

      // First child should be paragraph with resolved link
      const para = result.children[0] as Paragraph;
      expect(para.type).toBe("paragraph");

      const link = para.children[0] as Link;
      expect(link.type).toBe("link");
      expect(link.url).toBe("https://example.com");
      expect(link.title).toBe("Example Title");

      // Definition should still exist
      const def = result.children[1];
      expect(def.type).toBe("definition");
    });

    it("resolves shortcut linkReference [text]", () => {
      const md = `[example]

[example]: https://example.com`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      const link = para.children[0] as Link;
      expect(link.type).toBe("link");
      expect(link.url).toBe("https://example.com");
    });

    it("resolves collapsed linkReference [text][]", () => {
      const md = `[Example][]

[Example]: https://example.com`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      const link = para.children[0] as Link;
      expect(link.type).toBe("link");
      expect(link.url).toBe("https://example.com");
    });

    it("resolves imageReference to image using definition", () => {
      const md = `![Alt text][img]

[img]: https://example.com/image.png "Image Title"`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      const img = para.children[0] as Image;
      expect(img.type).toBe("image");
      expect(img.url).toBe("https://example.com/image.png");
      expect(img.title).toBe("Image Title");
      expect(img.alt).toBe("Alt text");
    });

    it("handles case-insensitive definition matching", () => {
      const md = `[Example][ID]

[id]: https://example.com`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      const link = para.children[0] as Link;
      expect(link.type).toBe("link");
      expect(link.url).toBe("https://example.com");
    });

    it("keeps linkReference as text when definition not found", () => {
      const md = `[Example][missing]`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      // GFM converts undefined references to literal text
      expect(para.children[0].type).toBe("text");
      expect((para.children[0] as Text).value).toBe("[Example][missing]");
    });

    it("keeps imageReference as text when definition not found", () => {
      const md = `![Alt text][missing]`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      // GFM converts undefined references to literal text
      expect(para.children[0].type).toBe("text");
      expect((para.children[0] as Text).value).toBe("![Alt text][missing]");
    });

    it("resolves link with definition that has no title", () => {
      const md = `[Example][ex]

[ex]: https://example.com`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      const link = para.children[0] as Link;
      expect(link.type).toBe("link");
      expect(link.url).toBe("https://example.com");
      expect(link.title).toBeNull();
    });

    it("resolves image with definition that has no title", () => {
      const md = `![Alt][img]

[img]: https://example.com/pic.png`;
      const result = parseMarkdownToMdast(md);

      const para = result.children[0] as Paragraph;
      const img = para.children[0] as Image;
      expect(img.type).toBe("image");
      expect(img.url).toBe("https://example.com/pic.png");
      expect(img.title).toBeNull();
      expect(img.alt).toBe("Alt");
    });
  });
});
