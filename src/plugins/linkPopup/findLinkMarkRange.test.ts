// @vitest-environment node
/**
 * findLinkMarkRange — the span of the link under a position.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { getProductionSchema } from "@/test/productionSchema";
import { findLinkMarkRange } from "./findLinkMarkRange";

// #1448 — a link that contains an image. The markdown pipeline now keeps the
// link mark on the image (it used to drop it), so every mark-span helper must
// treat a marked inline image as part of the span, not as a gap in it.
const prod = getProductionSchema();
/** "before " + image + " after" under one link to A.md: the link spans 1..15. */
function linkedImageDoc(imageMarked = true) {
  const link = prod.marks.link.create({ href: "A.md" });
  return prod.node("doc", null, [
    prod.node("paragraph", null, [
      prod.text("before ", [link]),
      prod.node("image", { src: "p.png" }, undefined, imageMarked ? [link] : []),
      prod.text(" after", [link]),
    ]),
  ]);
}

const viewOf = (doc: ReturnType<typeof linkedImageDoc>) =>
  ({ state: EditorState.create({ doc, schema: prod }) }) as unknown as EditorView;

describe("findLinkMarkRange with a linked image inside the link", () => {
  it.each([3, 8, 11])("spans text, image and text from position %i", (pos) => {
    const range = findLinkMarkRange(viewOf(linkedImageDoc()), pos);
    expect(range && { from: range.from, to: range.to }).toEqual({ from: 1, to: 15 });
  });

  it("stops at an UNLINKED image in the middle", () => {
    const range = findLinkMarkRange(viewOf(linkedImageDoc(false)), 3);
    expect(range && { from: range.from, to: range.to }).toEqual({ from: 1, to: 8 });
  });
});
