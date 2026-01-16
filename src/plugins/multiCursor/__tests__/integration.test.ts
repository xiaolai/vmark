import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { selectNextOccurrence } from "../commands";
import { handleMultiCursorInput } from "../inputHandling";
import { MultiSelection } from "../MultiSelection";

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

describe("multi-cursor integration", () => {
  it("selects next occurrence and edits all ranges", () => {
    const doc = createDoc("hello hello");
    let state = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
    });

    // Select first "hello"
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 6)));

    const tr = selectNextOccurrence(state);
    expect(tr).not.toBeNull();
    if (!tr) return;
    state = state.apply(tr);

    expect(state.selection).toBeInstanceOf(MultiSelection);

    const inputTr = handleMultiCursorInput(state, "X");
    expect(inputTr).not.toBeNull();
    if (!inputTr) return;

    const newState = state.apply(inputTr);
    expect(newState.doc.textContent).toBe("X X");
  });
});
