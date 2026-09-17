// @vitest-environment node
/**
 * Block bounds for occurrence selection (#1418).
 *
 * `selectAllOccurrences` already scopes itself when the caret is inside a code
 * block — `getCodeBlockBounds` returns a range and everything downstream is
 * filtered to it. #1418 asks for the same containment for ordinary prose, so
 * multi-cursor edits in a long document cannot reach past the paragraph you
 * are looking at. This is the bounds half; the command half reuses the
 * existing filter untouched.
 */
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { getTextblockBounds } from "./blockBounds";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    heading: { group: "block", content: "text*", toDOM: () => ["h1", 0] },
    codeBlock: { group: "block", content: "text*", code: true, toDOM: () => ["pre", 0] },
    blockquote: { group: "block", content: "block+", toDOM: () => ["blockquote", 0] },
    text: { inline: true },
  },
});

/** A doc of paragraphs, returned with the state so positions can be derived. */
function docOf(...blocks: { type: string; text: string }[]) {
  return EditorState.create({
    doc: schema.node(
      "doc",
      null,
      blocks.map((b) => schema.node(b.type, null, b.text ? [schema.text(b.text)] : [])),
    ),
  });
}

describe("getTextblockBounds", () => {
  it("bounds the paragraph the caret sits in, not the document", () => {
    const state = docOf(
      { type: "paragraph", text: "alpha beta" },
      { type: "paragraph", text: "gamma delta" },
    );
    // Position 3 is inside the FIRST paragraph (doc starts at 0, para content at 1).
    const bounds = getTextblockBounds(state, 3);
    expect(bounds).not.toBeNull();
    expect(state.doc.textBetween(bounds!.from, bounds!.to)).toBe("alpha beta");
  });

  it("bounds the second paragraph when the caret is there", () => {
    const state = docOf(
      { type: "paragraph", text: "alpha beta" },
      { type: "paragraph", text: "gamma delta" },
    );
    const secondStart = state.doc.content.firstChild!.nodeSize + 1;
    const bounds = getTextblockBounds(state, secondStart + 1);
    expect(state.doc.textBetween(bounds!.from, bounds!.to)).toBe("gamma delta");
  });

  it("treats a heading as its own block", () => {
    const state = docOf(
      { type: "heading", text: "Title" },
      { type: "paragraph", text: "body" },
    );
    const bounds = getTextblockBounds(state, 2);
    expect(state.doc.textBetween(bounds!.from, bounds!.to)).toBe("Title");
  });

  /**
   * A code block IS a textblock, so this returns the same range
   * `getCodeBlockBounds` would — the two agree rather than competing, which is
   * what makes the block-scoped command safe to run inside a fence.
   */
  it("agrees with the code-block bounds inside a fence", async () => {
    const { getCodeBlockBounds } = await import("./codeBlockBounds");
    const state = docOf({ type: "codeBlock", text: "const a = 1" });
    expect(getTextblockBounds(state, 2)).toEqual(getCodeBlockBounds(state, 2));
  });

  /** The INNERMOST textblock wins: a quoted paragraph bounds to the paragraph. */
  it("bounds to the innermost textblock inside a blockquote", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [
        schema.node("blockquote", null, [
          schema.node("paragraph", null, [schema.text("quoted one")]),
          schema.node("paragraph", null, [schema.text("quoted two")]),
        ]),
      ]),
    });
    const bounds = getTextblockBounds(state, 3);
    expect(state.doc.textBetween(bounds!.from, bounds!.to)).toBe("quoted one");
  });

  it("returns null when no textblock encloses the position", () => {
    const state = docOf({ type: "paragraph", text: "x" });
    // Position 0 is at doc level, outside any textblock.
    expect(getTextblockBounds(state, 0)).toBeNull();
  });

  it("bounds an empty paragraph to a zero-width range rather than failing", () => {
    const state = docOf({ type: "paragraph", text: "" });
    const bounds = getTextblockBounds(state, 1);
    expect(bounds).toEqual({ from: 1, to: 1 });
  });
});
