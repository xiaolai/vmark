import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applyInlineFormatToSelections } from "./formatMultiSelection";

function createView(doc: string, ranges: Array<{ from: number; to: number }>): EditorView {
  const parent = document.createElement("div");
  const selection = EditorSelection.create(
    ranges.map((range) => EditorSelection.range(range.from, range.to))
  );
  const state = EditorState.create({
    doc,
    selection,
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  return new EditorView({ state, parent });
}

describe("applyInlineFormatToSelections", () => {
  it("wraps multiple selections with underline markers", () => {
    const view = createView("one two three", [
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);

    const applied = applyInlineFormatToSelections(view, "underline");

    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toBe("++one++ ++two++ three");
    view.destroy();
  });
});
