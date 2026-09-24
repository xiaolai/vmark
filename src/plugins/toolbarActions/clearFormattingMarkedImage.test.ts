// @vitest-environment node
/**
 * Clear Formatting over a selection that contains a marked image.
 */

import { describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { getProductionSchema } from "@/test/productionSchema";
import { clearFormattingInView } from "./wysiwygAdapterFormatting";

// #1448 — images now keep the marks around them (a link, bold); Clear
// Formatting must strip those too, not only the text's.
describe("clearFormattingInView over a marked image", () => {
  it("removes the image's marks along with the text's", () => {
    const prod = getProductionSchema();
    const marks = [prod.marks.bold.create(), prod.marks.link.create({ href: "A.md" })];
    const doc = prod.node("doc", null, [
      prod.node("paragraph", null, [
        prod.text("before ", marks),
        prod.node("image", { src: "p.png" }, undefined, marks),
        prod.text(" after", marks),
      ]),
    ]);
    let state = EditorState.create({ doc, schema: prod });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 15)));
    const view = {
      get state() { return state; },
      dispatch: (tr: Transaction) => { state = state.apply(tr); },
      focus: vi.fn(),
    };

    expect(clearFormattingInView(view as never)).toBe(true);
    const leftovers: string[] = [];
    state.doc.descendants((n) => { n.marks.forEach((m) => leftovers.push(`${n.type.name}:${m.type.name}`)); });
    expect(leftovers).toEqual([]);
  });
});
