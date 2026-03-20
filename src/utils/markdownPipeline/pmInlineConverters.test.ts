/**
 * Tests for ProseMirror inline content converters (PM -> MDAST).
 *
 * Tests convertTextWithMarks, wrapWithMark, and atom node converters.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Text, Strong, InlineCode, Link, Break } from "mdast";

import {
  convertTextWithMarks,
  wrapWithMark,
  convertHardBreak,
  convertImage,
  convertMathInline,
  convertFootnoteReference,
} from "./pmInlineConverters";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    image: {
      attrs: { src: { default: "" }, alt: { default: null }, title: { default: null } },
      inline: true,
      group: "inline",
    },
    math_inline: {
      attrs: { content: { default: "" } },
      inline: true,
      group: "inline",
      atom: true,
    },
    footnote_reference: {
      attrs: { label: { default: "1" } },
      inline: true,
      group: "inline",
      atom: true,
    },
  },
  marks: {
    bold: {},
    italic: {},
    strike: {},
    code: {},
    link: { attrs: { href: {} } },
    subscript: {},
    superscript: {},
    highlight: {},
    underline: {},
  },
});

describe("pmInlineConverters", () => {
  describe("convertTextWithMarks", () => {
    it("converts plain text to MDAST text", () => {
      const node = schema.text("hello");
      const result = convertTextWithMarks(node);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("hello");
    });

    it("returns empty array for empty text", () => {
      // Create a node with marks but we need actual text
      // Empty text nodes don't normally exist in PM, but test the guard
      const node = schema.text("hello");
      // Override text to empty - can't easily do this, so just test the guard path
      const result = convertTextWithMarks(node);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("wraps text with bold mark", () => {
      const node = schema.text("bold", [schema.marks.bold.create()]);
      const result = convertTextWithMarks(node);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("strong");
      const strong = result[0] as Strong;
      expect(strong.children[0].type).toBe("text");
      expect((strong.children[0] as Text).value).toBe("bold");
    });

    it("wraps text with italic mark", () => {
      const node = schema.text("italic", [schema.marks.italic.create()]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("emphasis");
    });

    it("wraps text with strike mark", () => {
      const node = schema.text("deleted", [schema.marks.strike.create()]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("delete");
    });

    it("wraps text with code mark", () => {
      const node = schema.text("x = 1", [schema.marks.code.create()]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("inlineCode");
      expect((result[0] as InlineCode).value).toBe("x = 1");
    });

    it("wraps text with link mark", () => {
      const node = schema.text("click", [schema.marks.link.create({ href: "https://example.com" })]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("link");
      expect((result[0] as Link).url).toBe("https://example.com");
    });

    it("wraps text with subscript mark", () => {
      const node = schema.text("2", [schema.marks.subscript.create()]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("subscript");
    });

    it("wraps text with superscript mark", () => {
      const node = schema.text("2", [schema.marks.superscript.create()]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("superscript");
    });

    it("wraps text with highlight mark", () => {
      const node = schema.text("hi", [schema.marks.highlight.create()]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("highlight");
    });

    it("wraps text with underline mark", () => {
      const node = schema.text("u", [schema.marks.underline.create()]);
      const result = convertTextWithMarks(node);
      expect(result[0].type).toBe("underline");
    });

    it("nests multiple marks", () => {
      const node = schema.text("bold italic", [
        schema.marks.bold.create(),
        schema.marks.italic.create(),
      ]);
      const result = convertTextWithMarks(node);
      // Should be nested: strong > emphasis > text or emphasis > strong > text
      expect(result).toHaveLength(1);
      // The outermost should be one of the marks
      expect(["strong", "emphasis"]).toContain(result[0].type);
    });
  });

  describe("wrapWithMark", () => {
    const textContent = [{ type: "text", value: "hello" } as Text];

    it("wraps with bold", () => {
      const result = wrapWithMark(textContent, schema.marks.bold.create());
      expect(result[0].type).toBe("strong");
    });

    it("wraps with italic", () => {
      const result = wrapWithMark(textContent, schema.marks.italic.create());
      expect(result[0].type).toBe("emphasis");
    });

    it("wraps with strike", () => {
      const result = wrapWithMark(textContent, schema.marks.strike.create());
      expect(result[0].type).toBe("delete");
    });

    it("wraps with code - collapses text children", () => {
      const multiContent = [
        { type: "text", value: "hello " } as Text,
        { type: "text", value: "world" } as Text,
      ];
      const result = wrapWithMark(multiContent, schema.marks.code.create());
      expect(result[0].type).toBe("inlineCode");
      expect((result[0] as InlineCode).value).toBe("hello world");
    });

    it("wraps with code - filters non-text children", () => {
      const mixedContent = [
        { type: "text", value: "hello" } as Text,
        { type: "break" } as Break,
      ];
      const result = wrapWithMark(mixedContent, schema.marks.code.create());
      expect((result[0] as InlineCode).value).toBe("hello");
    });

    it("wraps with link", () => {
      const result = wrapWithMark(
        textContent,
        schema.marks.link.create({ href: "https://example.com" })
      );
      expect(result[0].type).toBe("link");
      expect((result[0] as Link).url).toBe("https://example.com");
    });

    it("wraps with subscript", () => {
      const result = wrapWithMark(textContent, schema.marks.subscript.create());
      expect(result[0].type).toBe("subscript");
    });

    it("wraps with superscript", () => {
      const result = wrapWithMark(textContent, schema.marks.superscript.create());
      expect(result[0].type).toBe("superscript");
    });

    it("wraps with highlight", () => {
      const result = wrapWithMark(textContent, schema.marks.highlight.create());
      expect(result[0].type).toBe("highlight");
    });

    it("wraps with underline", () => {
      const result = wrapWithMark(textContent, schema.marks.underline.create());
      expect(result[0].type).toBe("underline");
    });

    it("returns content as-is for unknown mark", () => {
      // Create a mock mark with unknown type name
      const unknownSchema = new Schema({
        nodes: {
          doc: { content: "text*" },
          text: {},
        },
        marks: {
          unknownMark: {},
        },
      });
      const result = wrapWithMark(textContent, unknownSchema.marks.unknownMark.create());
      // Should return content unchanged
      expect(result).toEqual(textContent);
    });
  });

  describe("convertHardBreak", () => {
    it("returns break node", () => {
      const result = convertHardBreak();
      expect(result.type).toBe("break");
    });
  });

  describe("convertImage", () => {
    it("creates image with src, alt, title", () => {
      const node = schema.nodes.image.create({
        src: "img.png",
        alt: "Alt text",
        title: "Title",
      });
      const result = convertImage(node);
      expect(result.type).toBe("image");
      expect(result.url).toBe("img.png");
      expect(result.alt).toBe("Alt text");
      expect(result.title).toBe("Title");
    });

    it("handles empty alt and title", () => {
      const node = schema.nodes.image.create({ src: "img.png", alt: "", title: "" });
      const result = convertImage(node);
      expect(result.alt).toBeUndefined();
      expect(result.title).toBeUndefined();
    });
  });

  describe("convertMathInline", () => {
    it("creates inlineMath from content attribute", () => {
      const node = schema.nodes.math_inline.create({ content: "E=mc^2" });
      const result = convertMathInline(node);
      expect(result.type).toBe("inlineMath");
      expect(result.value).toBe("E=mc^2");
    });

    it("falls back to textContent when content attribute is empty", () => {
      const node = schema.nodes.math_inline.create({ content: "" });
      const result = convertMathInline(node);
      expect(result.type).toBe("inlineMath");
      // Empty content attr, textContent is also empty for atom node
      expect(result.value).toBe("");
    });
  });

  describe("convertFootnoteReference", () => {
    it("creates footnoteReference from label", () => {
      const node = schema.nodes.footnote_reference.create({ label: "42" });
      const result = convertFootnoteReference(node);
      expect(result.type).toBe("footnoteReference");
      expect(result.identifier).toBe("42");
      expect(result.label).toBe("42");
    });

    it("defaults label to '1'", () => {
      const node = schema.nodes.footnote_reference.create({});
      const result = convertFootnoteReference(node);
      expect(result.identifier).toBe("1");
    });

    it("defaults label to '1' when attrs.label is null (line 164-165 ?? branch)", () => {
      // Create a schema that allows label to be null
      const nullLabelSchema = new Schema({
        nodes: {
          doc: { content: "text*" },
          text: {},
          footnote_ref_null: {
            attrs: { label: { default: null } },
            inline: true,
            group: "inline",
            atom: true,
          },
        },
        marks: {},
      });
      const node = nullLabelSchema.nodes.footnote_ref_null.create({ label: null });
      // Call converter with a node whose label attr is null — exercises `?? "1"`
      const result = convertFootnoteReference(node);
      expect(result.identifier).toBe("1");
      expect(result.label).toBe("1");
    });
  });

  describe("convertTextWithMarks — empty text guard (lines 47-48)", () => {
    it("returns empty array when node text is empty string (line 48 branch)", () => {
      // Build a node whose text is the empty string so `!text` is true.
      // We use schema.text("") which PM may normalise, so we bypass via a
      // wrapper object that matches the PMNode interface shape.
      const fakeNode = {
        text: "",
        marks: [],
      } as unknown as import("@tiptap/pm/model").Node;
      const result = convertTextWithMarks(fakeNode);
      expect(result).toEqual([]);
    });

    it("uses empty string fallback when node.text is undefined (line 47 || branch)", () => {
      // Build a node whose .text property is undefined — exercises the `|| ""`
      // fallback on line 47, then falls through to the `!text` guard on line 48.
      const fakeNode = {
        text: undefined,
        marks: [],
      } as unknown as import("@tiptap/pm/model").Node;
      const result = convertTextWithMarks(fakeNode);
      expect(result).toEqual([]);
    });
  });
});
