// @vitest-environment node
// WI-OC2.2 — building, extending and rendering a decoration set costs about
// linearly in the document (#1565). prosemirror-view assigned decorations to
// child nodes by scanning every decoration once per child, and `forChild` —
// which the view calls once per child node as it draws — scanned the children
// from the first on every call. A document of 340 headings and long CJK
// paragraphs carries tens of thousands of letter-spacing decorations, so both
// were quadratic where it hurts. VMark patches them (`patches/`).
//
// Timed at SMALL and LARGE blocks on the test thread's CPU clock
// (`measureGrowth`); the exponent must stay under MAX_EXPONENT. The patched
// work is a binary search per decoration (n log n, about 1.1 over this range);
// the unpatched work read about 2.
//
// Drawing is measured as the one call the patch changed: `forChild`, once per
// child in document order, as the view asks. A whole jsdom render would bury
// the quadratic term under DOM construction and pass either way. And the rest
// of the view's per-child step (reading the child's own decorations) is
// constant work whose memory outgrows the cache between SMALL and LARGE:
// measured with it, the exponent read 1.42–1.65 here, against 1.00–1.16 for
// `forChild` alone and 0.99–1.06 for a plain walk of the same documents.
import { describe, expect, it } from "vitest";
import { Schema, type Node } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { growthExponent, measureGrowth } from "@/test/cpuClock";

const SMALL = 400;
const LARGE = 4000;
const MAX_EXPONENT = 1.4;
const DECORATIONS_PER_BLOCK = 6;

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

interface Fixture {
  doc: Node;
  decorations: Decoration[];
}

/** `blocks` CJK paragraphs, each with a run of letter-spacing-like inline decorations. */
function fixture(blocks: number): Fixture {
  const text = "漢字かな漢字かな漢字かな";
  const doc = schema.node("doc", null, Array.from({ length: blocks }, () => schema.node("paragraph", null, [schema.text(text)])));
  const decorations: Decoration[] = [];
  doc.forEach((_, offset) => {
    for (let i = 0; i < DECORATIONS_PER_BLOCK; i++) {
      decorations.push(Decoration.inline(offset + 1 + i * 2, offset + 2 + i * 2, { class: "cjk-spacing" }));
    }
  });
  return { doc, decorations };
}

describe("decoration sets grow about linearly with the document", () => {
  it("DecorationSet.create", () => {
    const growth = measureGrowth(
      ({ doc, decorations }: Fixture) => {
        DecorationSet.create(doc, decorations.slice());
      },
      fixture(SMALL),
      fixture(LARGE),
    );
    expect(growthExponent(growth, SMALL, LARGE)).toBeLessThan(MAX_EXPONENT);
  });

  it("DecorationSet.add", () => {
    const withBase = (blocks: number) => {
      const { doc, decorations } = fixture(blocks);
      // A set that already has a child for every other block, so `add` both
      // extends existing children and inserts new ones.
      const base = DecorationSet.create(doc, decorations.filter((_, i) => i % (2 * DECORATIONS_PER_BLOCK) === 0));
      return { doc, base, decorations };
    };
    const growth = measureGrowth(
      ({ doc, base, decorations }: ReturnType<typeof withBase>) => {
        base.add(doc, decorations.slice());
      },
      withBase(SMALL),
      withBase(LARGE),
    );
    expect(growthExponent(growth, SMALL, LARGE)).toBeLessThan(MAX_EXPONENT);
  });

  it("forChild for every block, as the view asks while drawing", () => {
    const built = (blocks: number) => {
      const { doc, decorations } = fixture(blocks);
      return { doc, set: DecorationSet.create(doc, decorations) };
    };
    const growth = measureGrowth(
      ({ doc, set }: ReturnType<typeof built>) => {
        doc.forEach((child, offset) => {
          set.forChild(offset, child);
        });
      },
      built(SMALL),
      built(LARGE),
    );
    expect(growthExponent(growth, SMALL, LARGE)).toBeLessThan(MAX_EXPONENT);
  });
});
