import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import { getMultiCursorClipboardText, handleMultiCursorPaste } from "../clipboard";

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

function createState(text: string, ranges: Array<{ from: number; to: number }>) {
  const state = EditorState.create({
    doc: createDoc(text),
    schema,
    plugins: [multiCursorPlugin()],
  });

  const doc = state.doc;
  const selectionRanges = ranges.map((range) => {
    return new SelectionRange(doc.resolve(range.from), doc.resolve(range.to));
  });
  const multiSel = new MultiSelection(selectionRanges, 0);
  return state.apply(state.tr.setSelection(multiSel));
}

describe("clipboard", () => {
  it("concatenates multi-selection content with newlines", () => {
    const state = createState("hello world", [
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ]);

    const text = getMultiCursorClipboardText(state);
    expect(text).toBe("hello\nworld");
  });

  it("distributes lines when line count matches cursor count", () => {
    const state = createState("hello world", [
      { from: 1, to: 1 },
      { from: 7, to: 7 },
    ]);

    const tr = handleMultiCursorPaste(state, "A\nB");
    expect(tr).not.toBeNull();

    if (tr) {
      const newState = state.apply(tr);
      expect(newState.doc.textContent).toBe("Ahello Bworld");
    }
  });

  it("pastes full text at each cursor when line counts differ", () => {
    const state = createState("hello world", [
      { from: 1, to: 1 },
      { from: 7, to: 7 },
    ]);

    const tr = handleMultiCursorPaste(state, "ZZ");
    expect(tr).not.toBeNull();

    if (tr) {
      const newState = state.apply(tr);
      expect(newState.doc.textContent).toBe("ZZhello ZZworld");
    }
  });
});
