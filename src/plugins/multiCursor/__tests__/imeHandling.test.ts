import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import { handleMultiCursorInput, handleMultiCursorKeyDown } from "../inputHandling";

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

function createMultiCursorState(text: string) {
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

describe("imeHandling", () => {
  it("skips multi-cursor input while composing", () => {
    const state = createMultiCursorState("hello");
    const result = handleMultiCursorInput(state, "X", { isComposing: true });
    expect(result).toBeNull();
  });

  it("skips multi-cursor key handling for IME events", () => {
    const state = createMultiCursorState("hello");
    const result = handleMultiCursorKeyDown(state, {
      key: "Backspace",
      shiftKey: false,
      isComposing: true,
      keyCode: 229,
    });
    expect(result).toBeNull();
  });
});
