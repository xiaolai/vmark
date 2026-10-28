// @vitest-environment node
// WI-AL3.2 — the WYSIWYG selection map's sentinels are two private-use code points absent from the Markdown: found in one pass over it, so a document holding many private-use characters costs no more than one holding none, and a document holding every one of them maps nothing
import { describe, it, expect } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { growthExponent, measureGrowth } from "@/test/cpuClock";
import { mapWysiwygSelection } from "../wysiwygSelectionMap";

const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const serialize = (doc: PMNode) => doc.textContent;
const docOf = (text: string) => schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
const privateUse = (count: number) => Array.from({ length: count }, (_, i) => String.fromCharCode(0xe000 + i)).join("");

describe("mapWysiwygSelection — sentinels", () => {
  it("maps a selection exactly where the first private-use code points are taken", () => {
    const text = `${privateUse(3)}hello`;
    expect(mapWysiwygSelection(docOf(text), 4, 9, text, serialize)).toEqual({ from: 3, to: 8 });
  });

  it("maps nothing when every private-use code point is taken", () => {
    const text = `${privateUse(0x1900)}hello`;
    expect(mapWysiwygSelection(docOf(text), 1, 2, text, serialize)).toBeNull();
  });

  it("finds free sentinels at a cost that does not grow with the private-use code points taken", () => {
    const filler = "x".repeat(200_000);
    const mapOf = (text: string) => mapWysiwygSelection(docOf("a"), 1, 1, text, serialize);
    const growth = measureGrowth(mapOf, filler + privateUse(64), filler + privateUse(1024));
    expect(growthExponent(growth, 64, 1024)).toBeLessThan(0.5);
  });
});
