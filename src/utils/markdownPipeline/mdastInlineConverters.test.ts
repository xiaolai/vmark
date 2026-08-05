/**
 * Tests for MDAST inline node converters (MDAST -> ProseMirror).
 *
 * Tests each converter function directly with schema that has and lacks
 * the required marks/nodes, covering graceful fallback paths.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Content, Text, Strong, Emphasis, Delete, InlineCode, Link, Image, FootnoteReference } from "mdast";
import type { InlineMath } from "mdast-util-math";
import type { Subscript, Superscript, Highlight, Underline } from "./types";
import {
  convertText,
  convertStrong,
  convertEmphasis,
  convertDelete,
  convertInlineCode,
  convertLink,
  convertImage,
  convertBreak,
  convertInlineMath,
  convertFootnoteReference,
  convertSubscript,
  convertSuperscript,
  convertHighlight,
  convertUnderline,
} from "./mdastInlineConverters";

// Full schema with all marks and nodes
const fullSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    image: {
      attrs: { src: {}, alt: { default: null }, title: { default: null } },
      inline: true,
      group: "inline",
    },
    hardBreak: { inline: true, group: "inline" },
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

// Minimal schema without optional marks/nodes
const minimalSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
});

const convertChildrenMock = (children: readonly Content[], marks: import("@tiptap/pm/model").Mark[]) => {
  const result: import("@tiptap/pm/model").Node[] = [];
  for (const child of children) {
    if (child.type === "text") {
      result.push(fullSchema.text((child as Text).value, marks));
    }
  }
  return result;
};

const convertChildrenMinimal = (children: readonly Content[], marks: import("@tiptap/pm/model").Mark[]) => {
  const result: import("@tiptap/pm/model").Node[] = [];
  for (const child of children) {
    if (child.type === "text") {
      result.push(minimalSchema.text((child as Text).value, marks));
    }
  }
  return result;
};

describe("mdastInlineConverters", () => {
  describe("convertText", () => {
    it("converts text node to PM text", () => {
      const node: Text = { type: "text", value: "hello" };
      const result = convertText(fullSchema, node, []);
      expect(result).not.toBeNull();
      expect(result!.text).toBe("hello");
    });

    it("returns null for empty text", () => {
      const node: Text = { type: "text", value: "" };
      const result = convertText(fullSchema, node, []);
      expect(result).toBeNull();
    });

    it("preserves marks on text", () => {
      const node: Text = { type: "text", value: "bold" };
      const marks = [fullSchema.marks.bold.create()];
      const result = convertText(fullSchema, node, marks);
      expect(result!.marks).toHaveLength(1);
      expect(result!.marks[0].type.name).toBe("bold");
    });
  });

  describe("convertStrong", () => {
    it("adds bold mark to children", () => {
      const node: Strong = { type: "strong", children: [{ type: "text", value: "bold" }] };
      const result = convertStrong(fullSchema, node, [], convertChildrenMock);
      expect(result).toHaveLength(1);
      expect(result[0].marks.some((m) => m.type.name === "bold")).toBe(true);
    });

    it("stacks bold mark with existing marks", () => {
      const node: Strong = { type: "strong", children: [{ type: "text", value: "bold italic" }] };
      const existingMarks = [fullSchema.marks.italic.create()];
      const result = convertStrong(fullSchema, node, existingMarks, convertChildrenMock);
      expect(result[0].marks).toHaveLength(2);
    });

    it("falls back without bold mark in schema", () => {
      const node: Strong = { type: "strong", children: [{ type: "text", value: "bold" }] };
      const result = convertStrong(minimalSchema, node, [], convertChildrenMinimal);
      expect(result).toHaveLength(1);
      expect(result[0].marks).toHaveLength(0);
    });
  });

  describe("convertEmphasis", () => {
    it("adds italic mark to children", () => {
      const node: Emphasis = { type: "emphasis", children: [{ type: "text", value: "italic" }] };
      const result = convertEmphasis(fullSchema, node, [], convertChildrenMock);
      expect(result).toHaveLength(1);
      expect(result[0].marks.some((m) => m.type.name === "italic")).toBe(true);
    });

    it("falls back without italic mark in schema", () => {
      const node: Emphasis = { type: "emphasis", children: [{ type: "text", value: "italic" }] };
      const result = convertEmphasis(minimalSchema, node, [], convertChildrenMinimal);
      expect(result[0].marks).toHaveLength(0);
    });
  });

  describe("convertDelete", () => {
    it("adds strike mark to children", () => {
      const node: Delete = { type: "delete", children: [{ type: "text", value: "strike" }] };
      const result = convertDelete(fullSchema, node, [], convertChildrenMock);
      expect(result[0].marks.some((m) => m.type.name === "strike")).toBe(true);
    });

    it("falls back without strike mark in schema", () => {
      const node: Delete = { type: "delete", children: [{ type: "text", value: "strike" }] };
      const result = convertDelete(minimalSchema, node, [], convertChildrenMinimal);
      expect(result[0].marks).toHaveLength(0);
    });
  });

  describe("convertInlineCode", () => {
    it("adds code mark to text", () => {
      const node: InlineCode = { type: "inlineCode", value: "x = 1" };
      const result = convertInlineCode(fullSchema, node, []);
      expect(result).not.toBeNull();
      expect(result!.text).toBe("x = 1");
      expect(result!.marks.some((m) => m.type.name === "code")).toBe(true);
    });

    it("preserves existing marks when adding code", () => {
      const node: InlineCode = { type: "inlineCode", value: "code" };
      const existingMarks = [fullSchema.marks.bold.create()];
      const result = convertInlineCode(fullSchema, node, existingMarks);
      expect(result!.marks).toHaveLength(2);
    });

    it("falls back to plain text without code mark in schema", () => {
      const node: InlineCode = { type: "inlineCode", value: "x = 1" };
      const result = convertInlineCode(minimalSchema, node, []);
      expect(result).not.toBeNull();
      expect(result!.text).toBe("x = 1");
      expect(result!.marks).toHaveLength(0);
    });
  });

  describe("convertLink", () => {
    it("adds link mark with href", () => {
      const node: Link = {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: "link" }],
      };
      const result = convertLink(fullSchema, node, [], convertChildrenMock);
      expect(result).toHaveLength(1);
      const linkMark = result[0].marks.find((m) => m.type.name === "link");
      expect(linkMark).toBeDefined();
      expect(linkMark!.attrs.href).toBe("https://example.com");
    });

    it("stores a dangerous URL VERBATIM — sanitizing belongs at the sinks", () => {
      // Rewriting here rewrote the author's FILE on save. The scheme is
      // blocked where it matters (render + activation); see
      // linkSecurity.test.ts for the end-to-end proof.
      const node: Link = {
        type: "link",
        url: "javascript:alert(1)",
        children: [{ type: "text", value: "click" }],
      };
      const result = convertLink(fullSchema, node, [], convertChildrenMock);
      const linkMark = result[0].marks.find((m) => m.type.name === "link");
      expect(linkMark!.attrs.href).toBe("javascript:alert(1)");
    });

    it("preserves an unrecognized but harmless scheme", () => {
      const node: Link = {
        type: "link",
        url: "s3://bucket/key",
        children: [{ type: "text", value: "obj" }],
      };
      const result = convertLink(fullSchema, node, [], convertChildrenMock);
      const linkMark = result[0].marks.find((m) => m.type.name === "link");
      expect(linkMark!.attrs.href).toBe("s3://bucket/key");
    });

    it("falls back without link mark in schema", () => {
      const node: Link = {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: "link" }],
      };
      const result = convertLink(minimalSchema, node, [], convertChildrenMinimal);
      expect(result).toHaveLength(1);
      expect(result[0].marks).toHaveLength(0);
    });
  });

  describe("convertImage", () => {
    it("creates image node with src, alt, title", () => {
      const node: Image = {
        type: "image",
        url: "https://example.com/img.png",
        alt: "Alt text",
        title: "Title",
      };
      const result = convertImage(fullSchema, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("image");
      expect(result!.attrs.src).toBe("https://example.com/img.png");
      expect(result!.attrs.alt).toBe("Alt text");
      expect(result!.attrs.title).toBe("Title");
    });

    it("handles missing alt and title", () => {
      const node: Image = { type: "image", url: "img.png", alt: "", title: null };
      const result = convertImage(fullSchema, node);
      expect(result!.attrs.alt).toBeNull();
      expect(result!.attrs.title).toBeNull();
    });

    it("stores an image src verbatim — a scheme cannot execute from src", () => {
      const node: Image = { type: "image", url: "javascript:alert(1)", alt: "" };
      const result = convertImage(fullSchema, node);
      expect(result!.attrs.src).toBe("javascript:alert(1)");
    });

    it("returns null when image node not in schema", () => {
      const result = convertImage(minimalSchema, { type: "image", url: "img.png", alt: "" });
      expect(result).toBeNull();
    });
  });

  describe("convertBreak", () => {
    it("creates hardBreak node", () => {
      const result = convertBreak(fullSchema);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("hardBreak");
    });

    it("returns null when hardBreak not in schema", () => {
      const result = convertBreak(minimalSchema);
      expect(result).toBeNull();
    });
  });

  describe("convertInlineMath", () => {
    it("creates math_inline node with content", () => {
      const node = { type: "inlineMath", value: "E=mc^2" } as InlineMath;
      const result = convertInlineMath(fullSchema, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("math_inline");
      expect(result!.attrs.content).toBe("E=mc^2");
    });

    it("handles empty math content", () => {
      const node = { type: "inlineMath", value: "" } as InlineMath;
      const result = convertInlineMath(fullSchema, node);
      expect(result!.attrs.content).toBe("");
    });

    it("returns null when math_inline not in schema", () => {
      const node = { type: "inlineMath", value: "x" } as InlineMath;
      const result = convertInlineMath(minimalSchema, node);
      expect(result).toBeNull();
    });
  });

  describe("convertFootnoteReference", () => {
    it("creates footnote_reference node", () => {
      const node: FootnoteReference = { type: "footnoteReference", identifier: "1", label: "1" };
      const result = convertFootnoteReference(fullSchema, node);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("footnote_reference");
      expect(result!.attrs.label).toBe("1");
    });

    it("returns null when footnote_reference not in schema", () => {
      const node: FootnoteReference = { type: "footnoteReference", identifier: "1", label: "1" };
      const result = convertFootnoteReference(minimalSchema, node);
      expect(result).toBeNull();
    });
  });

  describe("convertSubscript", () => {
    it("adds subscript mark", () => {
      const node = { type: "subscript", children: [{ type: "text", value: "2" }] } as Subscript;
      const result = convertSubscript(fullSchema, node, [], convertChildrenMock);
      expect(result[0].marks.some((m) => m.type.name === "subscript")).toBe(true);
    });

    it("falls back without subscript mark in schema", () => {
      const node = { type: "subscript", children: [{ type: "text", value: "2" }] } as Subscript;
      const result = convertSubscript(minimalSchema, node, [], convertChildrenMinimal);
      expect(result[0].marks).toHaveLength(0);
    });
  });

  describe("convertSuperscript", () => {
    it("adds superscript mark", () => {
      const node = { type: "superscript", children: [{ type: "text", value: "2" }] } as Superscript;
      const result = convertSuperscript(fullSchema, node, [], convertChildrenMock);
      expect(result[0].marks.some((m) => m.type.name === "superscript")).toBe(true);
    });

    it("falls back without superscript mark in schema", () => {
      const node = { type: "superscript", children: [{ type: "text", value: "2" }] } as Superscript;
      const result = convertSuperscript(minimalSchema, node, [], convertChildrenMinimal);
      expect(result[0].marks).toHaveLength(0);
    });
  });

  describe("convertHighlight", () => {
    it("adds highlight mark", () => {
      const node = { type: "highlight", children: [{ type: "text", value: "hi" }] } as Highlight;
      const result = convertHighlight(fullSchema, node, [], convertChildrenMock);
      expect(result[0].marks.some((m) => m.type.name === "highlight")).toBe(true);
    });

    it("falls back without highlight mark in schema", () => {
      const node = { type: "highlight", children: [{ type: "text", value: "hi" }] } as Highlight;
      const result = convertHighlight(minimalSchema, node, [], convertChildrenMinimal);
      expect(result[0].marks).toHaveLength(0);
    });
  });

  describe("convertUnderline", () => {
    it("adds underline mark", () => {
      const node = { type: "underline", children: [{ type: "text", value: "u" }] } as Underline;
      const result = convertUnderline(fullSchema, node, [], convertChildrenMock);
      expect(result[0].marks.some((m) => m.type.name === "underline")).toBe(true);
    });

    it("falls back without underline mark in schema", () => {
      const node = { type: "underline", children: [{ type: "text", value: "u" }] } as Underline;
      const result = convertUnderline(minimalSchema, node, [], convertChildrenMinimal);
      expect(result[0].marks).toHaveLength(0);
    });
  });
});
