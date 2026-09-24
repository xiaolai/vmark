// @vitest-environment node
/**
 * linkRangeIsIntact — the guard that stops the link popup from applying a
 * captured range to a document that moved underneath it (audit 20260713).
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { linkRangeIsIntact } from "./linkRange";
import { getProductionSchema } from "@/test/productionSchema";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { inline: true, group: "inline" },
  },
  marks: {
    link: { attrs: { href: { default: "" } }, toDOM: (m) => ["a", { href: m.attrs.href }, 0] },
    bold: { toDOM: () => ["strong", 0] },
  },
});

const noLinkSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { inline: true, group: "inline" },
  },
});

const HREF = "https://example.com";

/** <p>{before}<a href=HREF>link</a>{after}</p> */
function docWithLink(before: string, linkText: string, after: string, href = HREF) {
  const nodes = [];
  if (before) nodes.push(schema.text(before));
  if (linkText) nodes.push(schema.text(linkText, [schema.marks.link.create({ href })]));
  if (after) nodes.push(schema.text(after));
  return EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, nodes)]),
  });
}

describe("linkRangeIsIntact", () => {
  it("accepts the exact range of the link", () => {
    // "aa" = 1..3, "link" = 3..7
    const state = docWithLink("aa", "link", " bb");
    expect(linkRangeIsIntact(state, 3, 7, HREF)).toBe(true);
  });

  it("accepts a link split across text nodes with the same href (bold + link)", () => {
    const link = schema.marks.link.create({ href: HREF });
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("ab", [schema.marks.bold.create(), link]),
          schema.text("cd", [link]),
        ]),
      ]),
    });
    expect(linkRangeIsIntact(state, 1, 5, HREF)).toBe(true);
  });

  it("rejects a range that has drifted onto plain text (doc edited under the popup)", () => {
    // The user opened the popup on 3..7, then an MCP edit inserted text before
    // the link: the same offsets now cover unlinked characters.
    const state = docWithLink("aa inserted", "link", " bb");
    expect(linkRangeIsIntact(state, 3, 7, HREF)).toBe(false);
  });

  it("rejects a range that only partially covers the link", () => {
    const state = docWithLink("aa", "link", " bb");
    // 3..9 runs past the link's end into plain text
    expect(linkRangeIsIntact(state, 3, 9, HREF)).toBe(false);
  });

  it("rejects when the href no longer matches", () => {
    const state = docWithLink("aa", "link", " bb", "https://other.example");
    expect(linkRangeIsIntact(state, 3, 7, HREF)).toBe(false);
  });

  it("rejects when the link mark was removed entirely", () => {
    const state = docWithLink("aa", "", " bb");
    expect(linkRangeIsIntact(state, 3, 7, HREF)).toBe(false);
  });

  it("rejects an out-of-bounds range (document shrank)", () => {
    const state = docWithLink("aa", "link", "");
    expect(linkRangeIsIntact(state, 3, 999, HREF)).toBe(false);
  });

  it("rejects an empty or inverted range", () => {
    const state = docWithLink("aa", "link", " bb");
    expect(linkRangeIsIntact(state, 5, 5, HREF)).toBe(false);
    expect(linkRangeIsIntact(state, 7, 3, HREF)).toBe(false);
    expect(linkRangeIsIntact(state, -1, 4, HREF)).toBe(false);
  });

  it("rejects when the schema has no link mark", () => {
    const state = EditorState.create({
      schema: noLinkSchema,
      doc: noLinkSchema.node("doc", null, [
        noLinkSchema.node("paragraph", null, [noLinkSchema.text("plain")]),
      ]),
    });
    expect(linkRangeIsIntact(state, 1, 3, HREF)).toBe(false);
  });
});

// #1448 — a link that contains an image. The markdown pipeline now keeps the
// link mark on the image (it used to drop it), so every mark-span helper must
// treat a marked inline image as part of the span, not as a gap in it.
const prod = getProductionSchema();
/** "before " + image + " after" under one link to A.md: the link spans 1..15. */
function linkedImageDoc(imageMarked = true) {
  const link = prod.marks.link.create({ href: "A.md" });
  return prod.node("doc", null, [
    prod.node("paragraph", null, [
      prod.text("before ", [link]),
      prod.node("image", { src: "p.png" }, undefined, imageMarked ? [link] : []),
      prod.text(" after", [link]),
    ]),
  ]);
}

describe("linkRangeIsIntact with a linked image inside the link", () => {
  it("counts the image as covered by the link", () => {
    const state = EditorState.create({ doc: linkedImageDoc(), schema: prod });
    expect(linkRangeIsIntact(state, 1, 15, "A.md")).toBe(true);
  });

  it("rejects the range when the image in it is not linked", () => {
    const state = EditorState.create({ doc: linkedImageDoc(false), schema: prod });
    expect(linkRangeIsIntact(state, 1, 15, "A.md")).toBe(false);
  });
});
