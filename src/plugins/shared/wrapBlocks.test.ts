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

/**
 * The caret callback is what stops a details wrapper putting the cursor in its
 * summary. Nothing exercised it, so the parameter could have been ignored
 * entirely and every test would still pass.
 */
describe("wrapSpannedBlocks caret placement", () => {
  const summarySchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      disclosure: { group: "block", content: "summary block+" },
      summary: { content: "inline*" },
      text: { group: "inline" },
    },
  });

  function disclosureState(text: string, from: number, to: number) {
    const doc = summarySchema.node("doc", null, [
      summarySchema.node("paragraph", null, [summarySchema.text(text)]),
    ]);
    const state = EditorState.create({ doc });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  }

  const buildDisclosure = (content: Parameters<Parameters<typeof wrapSpannedBlocks>[1]>[0]) =>
    summarySchema.node("disclosure", null, [
      summarySchema.node("summary", null, [summarySchema.text("Summary")]),
      ...content.content,
    ]);

  it("without a callback the caret lands in the SUMMARY — the bug being guarded", () => {
    const tr = wrapSpannedBlocks(disclosureState("body text", 2, 6), buildDisclosure)!;
    expect(tr.selection.$from.parent.type.name).toBe("summary");
  });

  it("with the callback it lands in the BODY", () => {
    const bodyOffset = (w: import("@tiptap/pm/model").Node) => 1 + (w.firstChild?.nodeSize ?? 0) + 1;
    const tr = wrapSpannedBlocks(disclosureState("body text", 2, 6), buildDisclosure, bodyOffset)!;
    expect(tr.selection.$from.parent.type.name).toBe("paragraph");
    expect(tr.selection.$from.parent.textContent).toBe("body text");
  });
});
