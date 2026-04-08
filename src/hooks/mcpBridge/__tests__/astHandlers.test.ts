/**
 * Tests for astHandlers — pure utility functions: generateNodeId,
 * resetNodeIdCounters, extractText, countWords, toAstNode, matchesQuery.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import {
  generateNodeId,
  resetNodeIdCounters,
  extractText,
  countWords,
  toAstNode,
  matchesQuery,
} from "../astHandlers";

// Minimal ProseMirror schema for tests
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      code: true,
      attrs: { language: { default: null } },
    },
    blockquote: { content: "block+", group: "block" },
    image: {
      group: "block",
      atom: true,
      attrs: { src: { default: "" }, alt: { default: null } },
    },
    text: { group: "inline", inline: true },
  },
  marks: {
    bold: {},
    italic: {},
  },
});

function p(text?: string) {
  if (!text) return schema.node("paragraph");
  return schema.node("paragraph", null, [schema.text(text)]);
}

function h(level: number, text: string) {
  return schema.node("heading", { level }, text ? [schema.text(text)] : []);
}

describe("astHandlers", () => {
  beforeEach(() => {
    resetNodeIdCounters();
  });

  describe("generateNodeId", () => {
    it("generates IDs with known prefix for standard types", () => {
      expect(generateNodeId("heading")).toBe("h-0");
      expect(generateNodeId("paragraph")).toBe("p-0");
      expect(generateNodeId("codeBlock")).toBe("code-0");
      expect(generateNodeId("blockquote")).toBe("quote-0");
    });

    it("increments counters per type", () => {
      expect(generateNodeId("heading")).toBe("h-0");
      expect(generateNodeId("heading")).toBe("h-1");
      expect(generateNodeId("heading")).toBe("h-2");
      expect(generateNodeId("paragraph")).toBe("p-0");
    });

    it("uses first 4 chars for unknown types", () => {
      expect(generateNodeId("customNode")).toBe("cust-0");
    });

    it("handles short unknown type names", () => {
      expect(generateNodeId("ab")).toBe("ab-0");
    });
  });

  describe("resetNodeIdCounters", () => {
    it("resets all counters", () => {
      generateNodeId("heading");
      generateNodeId("heading");
      generateNodeId("paragraph");
      resetNodeIdCounters();
      expect(generateNodeId("heading")).toBe("h-0");
      expect(generateNodeId("paragraph")).toBe("p-0");
    });
  });

  describe("extractText", () => {
    it("extracts text from paragraph", () => {
      expect(extractText(p("hello world"))).toBe("hello world");
    });

    it("returns empty string for empty paragraph", () => {
      expect(extractText(p())).toBe("");
    });

    it("extracts text from heading", () => {
      expect(extractText(h(1, "Title"))).toBe("Title");
    });

    it("extracts text from paragraph with marks", () => {
      const boldText = schema.text("bold", [schema.mark("bold")]);
      const normalText = schema.text(" normal");
      const node = schema.node("paragraph", null, [boldText, normalText]);
      expect(extractText(node)).toBe("bold normal");
    });

    it("extracts text from nested structure", () => {
      const doc = schema.node("doc", null, [
        p("first"),
        p("second"),
      ]);
      expect(extractText(doc)).toBe("firstsecond");
    });
  });

  describe("countWords", () => {
    it("counts words in simple text", () => {
      expect(countWords("hello world")).toBe(2);
    });

    it("returns 0 for empty string", () => {
      expect(countWords("")).toBe(0);
    });

    it("returns 0 for whitespace-only string", () => {
      expect(countWords("   ")).toBe(0);
    });

    it("handles multiple spaces between words", () => {
      expect(countWords("hello   world")).toBe(2);
    });

    it("handles tabs and newlines", () => {
      expect(countWords("hello\tworld\nfoo")).toBe(3);
    });

    it("handles single word", () => {
      expect(countWords("hello")).toBe(1);
    });
  });

  describe("toAstNode", () => {
    it("converts simple paragraph", () => {
      const node = p("hello");
      const ast = toAstNode(node);
      expect(ast.type).toBe("paragraph");
      expect(ast.text).toBe("hello");
      expect(ast.id).toMatch(/^p-/);
    });

    it("converts heading with attrs", () => {
      const node = h(2, "Sub");
      const ast = toAstNode(node);
      expect(ast.type).toBe("heading");
      expect(ast.text).toBe("Sub");
      expect(ast.attrs).toEqual({ level: 2 });
    });

    it("respects projection — excludes fields not in projection", () => {
      const node = h(1, "Title");
      const ast = toAstNode(node, ["type"]);
      expect(ast.type).toBe("heading");
      expect(ast.text).toBeUndefined();
      expect(ast.attrs).toBeUndefined();
    });

    it("includes text when in projection", () => {
      const node = p("hello");
      const ast = toAstNode(node, ["text"]);
      expect(ast.text).toBe("hello");
      expect(ast.attrs).toBeUndefined();
    });

    it("converts children for non-textblock nodes", () => {
      const bq = schema.node("blockquote", null, [p("quoted")]);
      const ast = toAstNode(bq);
      expect(ast.children).toHaveLength(1);
      expect(ast.children![0].type).toBe("paragraph");
      expect(ast.children![0].text).toBe("quoted");
    });

    it("does not include children for textblock nodes", () => {
      const node = p("hello");
      const ast = toAstNode(node);
      expect(ast.children).toBeUndefined();
    });
  });

  describe("matchesQuery", () => {
    it("matches by type string", () => {
      expect(matchesQuery(p("text"), { type: "paragraph" })).toBe(true);
      expect(matchesQuery(p("text"), { type: "heading" })).toBe(false);
    });

    it("matches by type array", () => {
      expect(
        matchesQuery(p("text"), { type: ["paragraph", "heading"] })
      ).toBe(true);
      expect(
        matchesQuery(p("text"), { type: ["heading", "codeBlock"] })
      ).toBe(false);
    });

    it("matches heading by level", () => {
      expect(matchesQuery(h(2, "Sub"), { level: 2 })).toBe(true);
      expect(matchesQuery(h(2, "Sub"), { level: 3 })).toBe(false);
    });

    it("level filter only applies to heading nodes", () => {
      // paragraph with level query — level is ignored for non-headings
      expect(matchesQuery(p("text"), { level: 1 })).toBe(true);
    });

    it("matches by contains (case insensitive)", () => {
      expect(matchesQuery(p("Hello World"), { contains: "hello" })).toBe(true);
      expect(matchesQuery(p("Hello World"), { contains: "WORLD" })).toBe(true);
      expect(matchesQuery(p("Hello World"), { contains: "xyz" })).toBe(false);
    });

    it("matches by hasMarks", () => {
      const boldText = schema.text("bold", [schema.mark("bold")]);
      const node = schema.node("paragraph", null, [boldText]);
      expect(matchesQuery(node, { hasMarks: ["bold"] })).toBe(true);
      expect(matchesQuery(node, { hasMarks: ["italic"] })).toBe(false);
    });

    it("hasMarks returns false for node with no marks", () => {
      expect(matchesQuery(p("plain"), { hasMarks: ["bold"] })).toBe(false);
    });

    it("matches empty query (no filters)", () => {
      expect(matchesQuery(p("text"), {})).toBe(true);
    });

    it("combines multiple filters with AND logic", () => {
      const node = h(2, "Important Section");
      expect(
        matchesQuery(node, {
          type: "heading",
          level: 2,
          contains: "important",
        })
      ).toBe(true);
      expect(
        matchesQuery(node, {
          type: "heading",
          level: 3,
          contains: "important",
        })
      ).toBe(false);
    });
  });
});
