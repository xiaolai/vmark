// @vitest-environment node
/**
 * Serialization completeness for code-block conversion: atoms and leaf
 * blocks (inline math, inline HTML, footnote refs, frontmatter, html_block,
 * TOC) must appear in the converted text — never silently vanish.
 */
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { textblockText, collectBlockLines } from "../codeBlockSerialize";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true },
    math_inline: { group: "inline", inline: true, atom: true, attrs: { content: { default: "" } } },
    html_inline: { group: "inline", inline: true, atom: true, attrs: { value: { default: "" } } },
    footnote_reference: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { label: { default: "" } },
    },
    inline_img: { group: "inline", inline: true, atom: true, attrs: { src: { default: "" } } },
    frontmatter: { group: "block", atom: true, attrs: { value: { default: "" } } },
    html_block: { group: "block", atom: true, attrs: { value: { default: "" } } },
    toc: { group: "block", atom: true },
    mystery_leaf: { group: "block", atom: true },
  },
});

describe("textblockText — inline atoms", () => {
  it("keeps inline math as $latex$", () => {
    const p = schema.node("paragraph", null, [
      schema.text("area "),
      schema.node("math_inline", { content: "x^2" }),
    ]);
    expect(textblockText(p)).toBe("area $x^2$");
  });

  it("keeps inline HTML value", () => {
    const p = schema.node("paragraph", null, [schema.node("html_inline", { value: "<kbd>K</kbd>" })]);
    expect(textblockText(p)).toBe("<kbd>K</kbd>");
  });

  it("keeps footnote references as [^label]", () => {
    const p = schema.node("paragraph", null, [
      schema.text("claim"),
      schema.node("footnote_reference", { label: "3" }),
    ]);
    expect(textblockText(p)).toBe("claim[^3]");
  });

  it("keeps inline atoms with a src attribute as their src", () => {
    const p = schema.node("paragraph", null, [schema.node("inline_img", { src: "./pic.png" })]);
    expect(textblockText(p)).toBe("./pic.png");
  });

  it("keeps hard breaks as newlines", () => {
    const p = schema.node("paragraph", null, [
      schema.text("a"),
      schema.node("hardBreak"),
      schema.text("b"),
    ]);
    expect(textblockText(p)).toBe("a\nb");
  });
});

describe("collectBlockLines — leaf blocks", () => {
  function lines(node: Parameters<typeof collectBlockLines>[0]): string[] {
    const out: string[] = [];
    collectBlockLines(node, 0, out);
    return out;
  }

  it("wraps frontmatter value in --- fences", () => {
    expect(lines(schema.node("frontmatter", { value: "title: Hi" }))).toEqual([
      "---",
      "title: Hi",
      "---",
    ]);
  });

  it("emits html_block value line by line", () => {
    expect(lines(schema.node("html_block", { value: "<div>\n</div>" }))).toEqual([
      "<div>",
      "</div>",
    ]);
  });

  it("emits [TOC] for toc atoms", () => {
    expect(lines(schema.node("toc"))).toEqual(["[TOC]"]);
  });

  it("emits nothing (not garbage) for an unknown empty leaf", () => {
    expect(lines(schema.node("mystery_leaf"))).toEqual([]);
  });
});
