import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { wrapSpannedBlocks } from "./wrapBlocks";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    wrapper: { group: "block", content: "block+" },
    text: { group: "inline" },
  },
});

function docOf(...paras: string[]) {
  return schema.node(
    "doc",
    null,
    paras.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])),
  );
}

function stateWithRange(doc: ReturnType<typeof docOf>, from: number, to: number) {
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

const wrap = (content: Parameters<Parameters<typeof wrapSpannedBlocks>[1]>[0]) =>
  schema.node("wrapper", null, content);

describe("wrapSpannedBlocks", () => {
  it("wraps the block a range sits inside", () => {
    const state = stateWithRange(docOf("hello world"), 2, 5);
    const tr = wrapSpannedBlocks(state, wrap);
    expect(tr).not.toBeNull();
    expect(tr!.doc.firstChild?.type.name).toBe("wrapper");
    expect(tr!.doc.textContent).toBe("hello world");
  });

  it("wraps EVERY block a multi-block range touches", () => {
    const state = stateWithRange(docOf("first", "second"), 2, 10);
    const tr = wrapSpannedBlocks(state, wrap);
    expect(tr!.doc.childCount).toBe(1);
    expect(tr!.doc.firstChild?.childCount).toBe(2);
  });

  it("returns null for an EMPTY selection, leaving the caller's insert path", () => {
    const state = stateWithRange(docOf("hello"), 3, 3);
    expect(wrapSpannedBlocks(state, wrap)).toBeNull();
  });

  it("returns null when the builder declines", () => {
    const state = stateWithRange(docOf("hello"), 1, 4);
    expect(wrapSpannedBlocks(state, () => null)).toBeNull();
  });

  it("returns null rather than wrapping nothing when the span is empty", () => {
    // An empty paragraph selected end-to-end has no content to move.
    const state = stateWithRange(docOf(""), 1, 1);
    expect(wrapSpannedBlocks(state, wrap)).toBeNull();
  });

  it("puts the caret inside the new wrapper", () => {
    const state = stateWithRange(docOf("hello world"), 2, 5);
    const tr = wrapSpannedBlocks(state, wrap)!;
    expect(tr.selection.from).toBeGreaterThan(0);
    expect(tr.selection.$from.parent.type.name).toBe("paragraph");
  });
});
