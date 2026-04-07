/**
 * Tests for [TOC] node through the full markdown pipeline.
 *
 * Verifies MDAST → ProseMirror → MDAST round-trip via the adapter.
 *
 * @module plugins/tableOfContents/__tests__/tocPipeline.test
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline/adapter";

// Minimal schema with heading and toc nodes
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM() { return ["p", 0]; },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: {
        level: { default: 1 },
        sourceLine: { default: null },
        id: { default: null },
      },
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
      ],
      toDOM(node) { return [`h${node.attrs.level}`, 0]; },
    },
    toc: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: { sourceLine: { default: null } },
      parseDOM: [{ tag: 'nav[data-type="toc"]' }],
      toDOM() {
        return ["nav", { "data-type": "toc", class: "toc-block" }];
      },
    },
    text: { inline: true, group: "inline" },
  },
});

describe("TOC pipeline", () => {
  it("parses [TOC] to a toc node", () => {
    const doc = parseMarkdown(schema, "[TOC]\n");
    let hasToc = false;
    doc.descendants((node) => {
      if (node.type.name === "toc") hasToc = true;
      return true;
    });
    expect(hasToc).toBe(true);
  });

  it("serializes toc node back to [TOC]", () => {
    const doc = parseMarkdown(schema, "[TOC]\n");
    const result = serializeMarkdown(schema, doc);
    expect(result.trim()).toBe("[TOC]");
  });

  it("round-trips [TOC] with surrounding content", () => {
    const input = "# Hello\n\n[TOC]\n\nSome text\n";
    const doc = parseMarkdown(schema, input);
    const result = serializeMarkdown(schema, doc);
    expect(result).toContain("# Hello");
    expect(result).toContain("[TOC]");
    expect(result).toContain("Some text");
  });

  it("preserves [TOC] position in document", () => {
    const input = "# Title\n\n[TOC]\n\n## Section\n";
    const doc = parseMarkdown(schema, input);
    const types: string[] = [];
    doc.forEach((node) => types.push(node.type.name));
    expect(types).toEqual(["heading", "toc", "heading"]);
  });

  it("does not create toc node from inline [TOC]", () => {
    const doc = parseMarkdown(schema, "Some text [TOC] more text\n");
    let hasToc = false;
    doc.descendants((node) => {
      if (node.type.name === "toc") hasToc = true;
      return true;
    });
    expect(hasToc).toBe(false);
  });

  it("handles multiple [TOC] in same document", () => {
    const doc = parseMarkdown(schema, "[TOC]\n\n# Section\n\n[TOC]\n");
    let tocCount = 0;
    doc.descendants((node) => {
      if (node.type.name === "toc") tocCount++;
      return true;
    });
    expect(tocCount).toBe(2);
  });

  it("handles empty document", () => {
    const doc = parseMarkdown(schema, "");
    // Empty markdown produces an empty doc — no TOC nodes created
    let hasToc = false;
    doc.descendants((node) => {
      if (node.type.name === "toc") hasToc = true;
      return true;
    });
    expect(hasToc).toBe(false);
  });

  it("preserves sourceLine attribute", () => {
    const doc = parseMarkdown(schema, "# Title\n\n[TOC]\n");
    let sourceLine: number | null = null;
    doc.descendants((node) => {
      if (node.type.name === "toc") {
        sourceLine = node.attrs.sourceLine;
      }
      return true;
    });
    expect(sourceLine).toBe(3);
  });

  it("case-insensitive [toc] parsing", () => {
    const doc = parseMarkdown(schema, "[toc]\n");
    let hasToc = false;
    doc.descendants((node) => {
      if (node.type.name === "toc") hasToc = true;
      return true;
    });
    expect(hasToc).toBe(true);
  });
});
