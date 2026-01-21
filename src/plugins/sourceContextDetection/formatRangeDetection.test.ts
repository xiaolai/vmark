import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getFormattedRangeAtCursor } from "./formatRangeDetection";

function createView(doc: string, cursor: number): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
  });
  return new EditorView({ state, parent });
}

describe("getFormattedRangeAtCursor", () => {
  it("detects underline ranges using ++ markers", () => {
    const view = createView("++under++", 4);
    const range = getFormattedRangeAtCursor(view);
    expect(range?.type).toBe("underline");
    expect(range?.contentFrom).toBe(2);
    expect(range?.contentTo).toBe(7);
    view.destroy();
  });

  it("returns null when cursor is outside underline markers", () => {
    const view = createView("++under++", 0);
    const range = getFormattedRangeAtCursor(view);
    expect(range).toBeNull();
    view.destroy();
  });
});
