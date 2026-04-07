/**
 * Tests for remarkTocBlock remark plugin and tocToMarkdown serialization.
 *
 * @module utils/markdownPipeline/plugins/tocBlock.test
 */

import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Root } from "mdast";
import { remarkTocBlock, tocToMarkdown } from "./tocBlock";

function parse(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkTocBlock);
  const tree = processor.parse(markdown);
  return processor.runSync(tree) as Root;
}

function roundTrip(markdown: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkTocBlock)
    .use(remarkStringify, { handlers: { ...tocToMarkdown.handlers } as Record<string, unknown> });
  const tree = processor.parse(markdown);
  const transformed = processor.runSync(tree);
  return processor.stringify(transformed as Root);
}

describe("remarkTocBlock", () => {
  it("converts [TOC] paragraph to toc node", () => {
    const tree = parse("[TOC]\n");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe("toc");
  });

  it("is case-insensitive", () => {
    const lower = parse("[toc]\n");
    expect(lower.children[0].type).toBe("toc");

    const mixed = parse("[Toc]\n");
    expect(mixed.children[0].type).toBe("toc");

    const upper = parse("[TOC]\n");
    expect(upper.children[0].type).toBe("toc");
  });

  it("allows surrounding whitespace in the paragraph", () => {
    const tree = parse("  [TOC]  \n");
    expect(tree.children[0].type).toBe("toc");
  });

  it("does not convert [TOC] when mixed with other content", () => {
    const tree = parse("Some text [TOC] more text\n");
    expect(tree.children[0].type).toBe("paragraph");
  });

  it("does not convert [TOC] inside code blocks", () => {
    const tree = parse("```\n[TOC]\n```\n");
    expect(tree.children[0].type).toBe("code");
  });

  it("does not convert [TOC] inside inline code", () => {
    const tree = parse("`[TOC]`\n");
    expect(tree.children[0].type).toBe("paragraph");
  });

  it("preserves position from original paragraph", () => {
    const tree = parse("# Heading\n\n[TOC]\n\nSome text\n");
    const tocNode = tree.children.find((n) => n.type === "toc");
    expect(tocNode).toBeDefined();
    expect(tocNode!.position).toBeDefined();
    expect(tocNode!.position!.start.line).toBe(3);
  });

  it("does not match [TOC] with extra text nodes", () => {
    const tree = parse("[TOC] extra\n");
    expect(tree.children[0].type).toBe("paragraph");
  });

  it("handles document with multiple [TOC] markers", () => {
    const tree = parse("[TOC]\n\n# Heading\n\n[TOC]\n");
    const tocNodes = tree.children.filter((n) => n.type === "toc");
    expect(tocNodes).toHaveLength(2);
  });

  it("handles empty document", () => {
    const tree = parse("");
    expect(tree.children).toHaveLength(0);
  });
});

describe("tocToMarkdown", () => {
  it("serializes toc node back to [TOC]", () => {
    const result = roundTrip("[TOC]\n");
    expect(result.trim()).toBe("[TOC]");
  });

  it("preserves surrounding content in round-trip", () => {
    const result = roundTrip("# Heading\n\n[TOC]\n\nSome text\n");
    expect(result).toContain("# Heading");
    expect(result).toContain("[TOC]");
    expect(result).toContain("Some text");
  });

  it("round-trips multiple [TOC] markers", () => {
    const result = roundTrip("[TOC]\n\n# Section\n\n[TOC]\n");
    const matches = result.match(/\[TOC\]/g);
    expect(matches).toHaveLength(2);
  });
});
