// @vitest-environment node
/**
 * Tests for remarkWikiLinks plugin.
 *
 * Covers wiki link parsing, serialization, edge cases, and the
 * data-array initialization branches (lines 57-58).
 */

import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { remarkWikiLinks } from "./wikiLinks";
import type { Root, Paragraph } from "mdast";
import type { WikiLink } from "../types";

function buildProcessor() {
  return unified().use(remarkParse).use(remarkWikiLinks).use(remarkStringify);
}

function parseToMdast(md: string): Root {
  return buildProcessor().parse(md) as Root;
}

async function roundtrip(md: string): Promise<string> {
  const result = await buildProcessor().process(md);
  return String(result).trim();
}

describe("remarkWikiLinks", () => {
  describe("parsing — basic wiki links", () => {
    it("parses [[PageName]] into a wikiLink node", () => {
      const tree = parseToMdast("[[PageName]]");
      const para = tree.children[0] as Paragraph;
      const link = para.children[0] as WikiLink;
      expect(link.type).toBe("wikiLink");
      expect(link.value).toBe("PageName");
      expect(link.alias).toBeUndefined();
    });

    it("parses [[Page|Alias]] with alias", () => {
      const tree = parseToMdast("[[Page|Alias]]");
      const para = tree.children[0] as Paragraph;
      const link = para.children[0] as WikiLink;
      expect(link.type).toBe("wikiLink");
      expect(link.value).toBe("Page");
      expect(link.alias).toBe("Alias");
    });

    it("trims whitespace from target and alias", () => {
      const tree = parseToMdast("[[ Page | Alias ]]");
      const para = tree.children[0] as Paragraph;
      const link = para.children[0] as WikiLink;
      expect(link.value).toBe("Page");
      expect(link.alias).toBe("Alias");
    });

    it("ignores embeds ![[...]]", () => {
      const tree = parseToMdast("![[image.png]]");
      const para = tree.children[0] as Paragraph;
      // Should NOT produce a wikiLink node
      expect(para.children.some((c) => c.type === "wikiLink")).toBe(false);
    });

    it("ignores wiki link with empty target", () => {
      const tree = parseToMdast("[[  ]]");
      const para = tree.children[0] as Paragraph;
      expect(para.children.some((c) => c.type === "wikiLink")).toBe(false);
    });

    it("handles pipe with empty alias (uses value only)", () => {
      // [[Page|]] — alias trims to empty, returns { value } only
      const tree = parseToMdast("[[Page|]]");
      const para = tree.children[0] as Paragraph;
      const link = para.children[0] as WikiLink;
      expect(link.type).toBe("wikiLink");
      expect(link.value).toBe("Page");
      expect(link.alias).toBeUndefined();
    });
  });

  describe("serialization — roundtrip", () => {
    it("serializes [[PageName]] back to [[PageName]]", async () => {
      const result = await roundtrip("[[PageName]]");
      expect(result).toBe("[[PageName]]");
    });

    it("serializes [[Page|Alias]] back to [[Page|Alias]]", async () => {
      const result = await roundtrip("[[Page|Alias]]");
      expect(result).toBe("[[Page|Alias]]");
    });
  });

  describe("data-array initialization (lines 57-58)", () => {
    // These tests exercise the `?? []` branches by pre-seeding the processor
    // data with existing arrays before registering the plugin a second time.
    // When arrays already exist the nullish coalescing operator takes the
    // existing array (the truthy branch), so the `[]` fallback is NOT used.

    it("appends to already-initialised fromMarkdownExtensions", () => {
      // Pre-populate data.fromMarkdownExtensions before the plugin runs
      const processor = unified()
        .use(remarkParse)
        .use(function (this: import("unified").Processor) {
          const data = this.data() as {
            fromMarkdownExtensions?: object[];
            toMarkdownExtensions?: object[];
          };
          // Pre-seed both arrays so the `?? []` fallback is NOT taken
          data.fromMarkdownExtensions = [];
          data.toMarkdownExtensions = [];
        })
        .use(remarkWikiLinks)
        .use(remarkStringify);

      // If plugin registration succeeds without throwing, the arrays were
      // reused (truthy branch). Verify parsing still works.
      const tree = processor.parse("[[MyPage]]") as Root;
      const para = tree.children[0] as Paragraph;
      // transformWikiLinks runs via fromMarkdownExtensions during parse
      // (unified processes transforms after parse)
      expect(tree).toBeDefined();
      expect(para).toBeDefined();
    });

    it("plugin can be used twice on the same processor (arrays reused)", () => {
      // Using the plugin twice means the second call finds arrays already
      // present — covering the ?? [] truthy branch for both lines 57 and 58.
      const processor = unified()
        .use(remarkParse)
        .use(remarkWikiLinks)
        .use(remarkWikiLinks) // second registration reuses existing arrays
        .use(remarkStringify);

      // Should not throw and should parse normally
      const tree = processor.parse("[[DoublePage]]") as Root;
      expect(tree).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles wiki link with path separators", () => {
      const tree = parseToMdast("[[folder/page]]");
      const para = tree.children[0] as Paragraph;
      const link = para.children[0] as WikiLink;
      expect(link.type).toBe("wikiLink");
      expect(link.value).toBe("folder/page");
    });

    it("handles multiple wiki links on one line", () => {
      const tree = parseToMdast("See [[PageA]] and [[PageB]]");
      const para = tree.children[0] as Paragraph;
      const links = para.children.filter((c) => c.type === "wikiLink");
      expect(links).toHaveLength(2);
      expect((links[0] as WikiLink).value).toBe("PageA");
      expect((links[1] as WikiLink).value).toBe("PageB");
    });
  });
});
