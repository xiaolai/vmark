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
// the unpatched work read about 2. The bound is the 1.35 this repo's other
// linear-growth tests use, whose worst reading under coverage and load was
// 1.27 (`src/test/cpuClock.ts`). Idle readings here are 1.01–1.19, so the
// plan's 1.2 would fail on noise rather than on a quadratic term.
//
// Drawing is measured as the one call the patch changed: `forChild`, once per
// child in document order, as the view asks. A whole jsdom render would bury
// the quadratic term under DOM construction and pass either way. And the rest
// of the view's per-child step (reading the child's own decorations) is
// constant work whose memory outgrows the cache between SMALL and LARGE:
// measured with it, the exponent read 1.42–1.65 here, against 1.00–1.16 for
// `forChild` alone and 0.99–1.06 for a plain walk of the same documents.
//
// `add` is timed over a larger range. Inserting a new child into the children
// array with `splice` shifts every entry after it, a memmove whose quadratic
// term is too small to read over 400–4000 blocks (1.11–1.27) but plain over
// 2000–20000 (1.48–1.56) and 4000–40000 (1.66), where `create` read 0.92–0.99.
// The patch merges the children into a new array instead: 1.03–1.08.
import { describe, expect, it } from "vitest";
import { Schema, type Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { growthExponent, measureGrowth } from "@/test/cpuClock";

const SMALL = 400;
const LARGE = 4000;
const MAX_EXPONENT = 1.35;
const ADD_SMALL = 2000;
const ADD_LARGE = 20000;
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
      withBase(ADD_SMALL),
      withBase(ADD_LARGE),
    );
    expect(growthExponent(growth, ADD_SMALL, ADD_LARGE)).toBeLessThan(MAX_EXPONENT);
  });

  it("DecorationSet.add in front of existing children", () => {
    // Every new child lands before all the old ones, the shape where splicing
    // each one in shifted the most: half the blocks decorated at the end, then
    // the first half added.
    const withSuffix = (blocks: number) => {
      const { doc, decorations } = fixture(blocks);
      const half = (blocks / 2) * DECORATIONS_PER_BLOCK;
      return { doc, base: DecorationSet.create(doc, decorations.slice(half)), front: decorations.slice(0, half) };
    };
    const growth = measureGrowth(
      ({ doc, base, front }: ReturnType<typeof withSuffix>) => {
        base.add(doc, front.slice());
      },
      withSuffix(SMALL),
      withSuffix(LARGE),
    );
    expect(growthExponent(growth, SMALL, LARGE)).toBeLessThan(MAX_EXPONENT);
  });

  it("DecorationSet.map through a replacement of every block", () => {
    // Every child is touched, so all of them are gathered and rebuilt; taking
    // the old entries out and putting the rebuilt ones in by splice was
    // quadratic in the children.
    const replaced = (blocks: number) => {
      const { doc, decorations } = fixture(blocks);
      const set = DecorationSet.create(doc, decorations);
      const tr = new Transform(doc).replaceWith(0, doc.content.size, fixture(blocks).doc.content);
      return { set, tr };
    };
    const growth = measureGrowth(
      ({ set, tr }: ReturnType<typeof replaced>) => {
        set.map(tr.mapping, tr.doc);
      },
      replaced(SMALL),
      replaced(LARGE),
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
