import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import { handleMultiCursorInput, handleMultiCursorBackspace } from "../inputHandling";
import { handleMultiCursorPaste } from "../clipboard";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

function createMultiState(text: string) {
  const state = EditorState.create({
    doc: createDoc(text),
    schema,
    plugins: [multiCursorPlugin()],
  });

  const doc = state.doc;
  const ranges = [
    new SelectionRange(doc.resolve(1), doc.resolve(1)),
    new SelectionRange(doc.resolve(3), doc.resolve(3)),
  ];
  const multiSel = new MultiSelection(ranges, 0);
  return state.apply(state.tr.setSelection(multiSel));
}

describe("history", () => {
  it("marks multi-cursor input as single history step", () => {
    const state = createMultiState("hello");
    const tr = handleMultiCursorInput(state, "X");
    expect(tr?.getMeta("addToHistory")).toBe(true);
  });

  it("marks multi-cursor paste as single history step", () => {
    const state = createMultiState("hello");
    const tr = handleMultiCursorPaste(state, "A\nB");
    expect(tr?.getMeta("addToHistory")).toBe(true);
  });

  it("marks multi-cursor delete as single history step", () => {
    const state = createMultiState("hello");
    const tr = handleMultiCursorBackspace(state);
    expect(tr?.getMeta("addToHistory")).toBe(true);
  });
});
