// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMarkdownProcessor } from "@/utils/markdownPipeline/parser";

describe("createMarkdownProcessor (lint mode)", () => {
  it("parses markdown into MDAST with position data", () => {
    const processor = createMarkdownProcessor();
    const tree = processor.parse("# Hello\n\nWorld");
    expect(tree.type).toBe("root");
    expect(tree.children.length).toBeGreaterThan(0);
    expect(tree.children[0].position).toBeDefined();
    expect(tree.children[0].position!.start.line).toBe(1);
  });

  it("preserves original source positions without normalization", () => {
    // Key: createMarkdownProcessor does NOT call normalizeBareListMarkers,
    // so positions reflect the raw source text as-is.
    const source = "# Hello\n\nParagraph text here.";
    const processor = createMarkdownProcessor();
    const tree = processor.parse(source);
    // Heading at line 1, column 1
    expect(tree.children[0].position!.start.line).toBe(1);
    expect(tree.children[0].position!.start.column).toBe(1);
    expect(tree.children[0].position!.start.offset).toBe(0);
    // Paragraph at line 3
    expect(tree.children[1].position!.start.line).toBe(3);
  });

  it("loads GFM plugin (tables)", () => {
    const source = "| a | b |\n| - | - |\n| 1 | 2 |";
    const processor = createMarkdownProcessor();
    const tree = processor.parse(source);
    const table = tree.children.find((n) => n.type === "table");
    expect(table).toBeDefined();
  });

  it("loads math plugin", () => {
    const source = "$$\nx = 1\n$$";
    const processor = createMarkdownProcessor();
    const tree = processor.parse(source);
    const math = tree.children.find((n) => n.type === "math");
    expect(math).toBeDefined();
  });

  it("loads frontmatter plugin", () => {
    const source = "---\ntitle: test\n---\n\n# Hello";
    const processor = createMarkdownProcessor();
    const tree = processor.parse(source);
    const yaml = tree.children.find((n) => n.type === "yaml");
    expect(yaml).toBeDefined();
  });
});
