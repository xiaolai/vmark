// @vitest-environment node
// WI-OC2.2 — VMark patches prosemirror-view's decoration tree (#1565):
// `buildTree` and `addInner` assigned decorations to child nodes by scanning
// every decoration once per child, and `forChild` found a child by scanning
// from the first one on every call. Those scans made a large document's
// decorations quadratic to build and to render. The patch replaces them with
// one binary-searched pass; this test holds it to the unpatched algorithm
// (`decorationSetReference.ts`) on generated documents and decoration sets.
//
// Equality is `eq`, the library's own structural comparison — every local
// decoration in order, every child range, recursively — which is stronger
// than comparing a rendering: the view draws a set as a function of exactly
// that structure. `find()` is compared too, for a readable diff when it fails.
//
// Mapping is held to a different oracle: each decoration mapped on its own and
// the tree rebuilt (`individuallyMapped`). The patch also fixes upstream's
// `mapChildren`, which kept child sets where no child node is — after a later
// step replaced a touched child's opening token, after a wrap moved an
// untouched child, through a mirrored mapping — so for `map`, upstream is not
// the reference. Each seed maps a whole edit and a typed character.
import { describe, expect, it } from "vitest";
import type { Node } from "@tiptap/pm/model";
import { Mapping, Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type DecorationSource } from "@tiptap/pm/view";
import { referenceAdd, referenceCreate, referenceForChild } from "./decorationSetReference";
import {
  decorationsOf, documentOf, drawn, editsOf, individuallyMapped, individuallyMappedNodes, nodeLines, schema, seeded, typedIn,
  unsoundNodeDecorations,
} from "./decorationSetFixtures";

const CASES = 300;

function expectSameSet(actual: DecorationSet, expected: DecorationSet, label: string) {
  expect(actual.find(), label).toEqual(expected.find());
  expect((actual as unknown as { eq(o: DecorationSet): boolean }).eq(expected), label).toBe(true);
}

/** A mapping and the document it maps onto: a whole transform, or a slice of one. */
interface Mapped {
  mapping: Mapping;
  doc: Node;
}

/**
 * A mapped set against the oracle. Inline decorations and widgets: what a
 * view would DRAW from it equals what it draws from the decorations mapped one
 * by one (`individuallyMapped`). Node decorations: each one it keeps covers a
 * node exactly and is what mapping its original alone gives — range and
 * identity — and it draws every one `find()` reports — no subtree kept under
 * the wrong parent.
 */
function expectMappedLike(mapped: DecorationSet, original: readonly Decoration[], { mapping, doc }: Mapped, label: string) {
  const positional = (lines: string[]) => lines.filter((line) => !line.includes(" node ")).sort();
  const oracle = individuallyMapped(original, mapping, doc);
  expect(positional(drawn(mapped, doc)), `${label} drawn`).toEqual(positional(drawn(oracle, doc)));
  expect(unsoundNodeDecorations(mapped, original, mapping, doc), `${label} node decorations`).toEqual([]);
  const drawnNodes = (lines: string[]) => lines.filter((line) => line.includes(" node ")).sort();
  expect(drawnNodes(drawn(mapped, doc)), `${label} node decorations drawn`).toEqual(nodeLines(mapped.find()));
}

function membersOf(source: DecorationSource): DecorationSet[] {
  const members = (source as unknown as { members?: DecorationSet[] }).members;
  return members ? [...members] : source === DecorationSet.empty ? [] : [source as DecorationSet];
}

/**
 * `forChild` at every child of `node`, recursively, against the reference —
 * in document order, as the view asks, then in reverse, so the patched
 * lookup's hint (the entry its last call found) is also tested when it is
 * wrong.
 */
function expectSameForChild(set: DecorationSet, node: Node, label: string) {
  const children: { child: Node; offset: number }[] = [];
  node.forEach((child, offset) => children.push({ child, offset }));
  for (const { child, offset } of [...children, ...children.slice().reverse()]) {
    const actual = membersOf(set.forChild(offset, child));
    const { child: refChild, local: refLocal } = referenceForChild(set, offset, child);
    // Composed as the library composes it: `[local, child]` as a group, or
    // whichever exists alone. `addInner` can store the shared empty set as a
    // child, and a lone child that IS the empty set is no member at all.
    const expected = refLocal
      ? refChild ? [refLocal, refChild] : [refLocal]
      : refChild && refChild !== DecorationSet.empty ? [refChild] : [];
    expect(actual.length, `${label} @${offset}`).toBe(expected.length);
    actual.forEach((member, i) => expectSameSet(member, expected[i], `${label} @${offset}[${i}]`));
    if (refChild) expectSameForChild(refChild, child, `${label}/${offset}`);
  }
}

describe("the patched decoration tree agrees with the unpatched algorithm", () => {
  it.each(Array.from({ length: CASES }, (_, seed) => seed))("case %i", (seed) => {
    const random = seeded(seed);
    const doc = documentOf(random);
    const first = decorationsOf(doc, random, "a");
    const more = decorationsOf(doc, random, "b");

    const created = DecorationSet.create(doc, first.slice());
    expectSameSet(created, referenceCreate(doc, first.slice()), `create #${seed}`);

    const added = created.add(doc, more.slice());
    expectSameSet(added, referenceAdd(created, doc, more.slice()), `add #${seed}`);

    expectSameForChild(added, doc, `forChild #${seed}`);

    // Mapping rebuilds changed children and splices them back in: the binary
    // search in `forChild` holds only while child ranges stay sorted.
    const tr = editsOf(doc, random);
    const mapped = added.map(tr.mapping, tr.doc);
    expectMappedLike(mapped, added.find(), tr, `map #${seed}`);
    expectSameForChild(mapped, tr.doc, `map+forChild #${seed}`);

    // Typing moves no node, so no node decoration may be dropped.
    const typed = typedIn(doc, random);
    if (typed) {
      const kept = added.map(typed.mapping, typed.doc);
      expect(nodeLines(kept.find()), `typed #${seed}`).toEqual(nodeLines(individuallyMappedNodes(added.find(), typed.mapping)));
      expectMappedLike(kept, added.find(), typed, `typed #${seed}`);
    }
  });
});

describe("cases the audit found", () => {
  const p = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const quote = (...blocks: Node[]) => schema.nodes.blockquote.create(null, blocks);

  it("a reversed span goes to the child upstream gives it", () => {
    const doc = schema.nodes.doc.create(null, [p("abcdef"), p("ghijkl"), p("mnopqr")]);
    const base = DecorationSet.create(doc, [Decoration.inline(1, 2, { class: "a" })]);
    const more = () => [Decoration.inline(12, 2, { class: "b" })];
    expectSameSet(base.add(doc, more()), referenceAdd(base, doc, more()), "reversed span");
  });

  it("a later step that replaces a touched child's opening token", () => {
    // Step 1 replaces the last paragraph, touching the second quote at its
    // end; step 2 deletes from that quote's start into its first paragraph,
    // and the fitter re-creates the quote. The quote is not the same node.
    const doc = schema.nodes.doc.create(null, [quote(p("汉字かなA"), p("ABC")), quote(p("A 中文 B"), p("汉字かなA")), p("中文")]);
    const set = DecorationSet.create(doc, [Decoration.inline(24, 28, { class: "cjk" }), Decoration.inline(2, 6, { class: "cjk" })]);
    const tr = new Transform(doc).replaceWith(31, 35, schema.text("汉")).delete(14, 20);
    expectMappedLike(set.map(tr.mapping, tr.doc), set.find(), tr, "compound edit");
  });

  it("wrapping blocks in a quote moves an untouched child's decorations with it", () => {
    // The wrap inserts the quote's tokens around three paragraphs. The middle
    // one is never touched, so upstream shifts its entry and keeps it at the
    // root, where no node starts — the view never draws it.
    const doc = schema.nodes.doc.create(null, [p("汉字"), p("かな"), p("中文")]);
    const set = DecorationSet.create(doc, [1, 5, 9].map((from) => Decoration.inline(from, from + 2, { class: "cjk" })));
    const tr = new Transform(doc);
    const range = doc.resolve(1).blockRange(doc.resolve(11))!;
    tr.wrap(range, [{ type: schema.nodes.blockquote }]);
    expectMappedLike(set.map(tr.mapping, tr.doc), set.find(), tr, "wrap");
  });

  it("a mapping and its inverse, mirrored, give the set back", () => {
    const doc = schema.nodes.doc.create(null, [quote(p("abc"), p("def"))]);
    const set = DecorationSet.create(doc, [Decoration.inline(7, 10, { class: "x" })]);
    const tr = new Transform(doc).split(2);
    tr.lift(tr.doc.resolve(1).blockRange(tr.doc.resolve(2))!, 0);
    const mapping = new Mapping();
    mapping.appendMapping(tr.mapping);
    for (let i = tr.mapping.maps.length - 1; i >= 0; i--) mapping.appendMap(tr.mapping.maps[i].invert(), i);
    expect(drawn(set.map(mapping, doc), doc)).toEqual(drawn(set, doc));
  });

  it("a node decoration whose node moves under a new parent is dropped, as upstream does", () => {
    const doc = schema.nodes.doc.create(null, [p("abc")]);
    const removed: unknown[] = [];
    const set = DecorationSet.create(doc, [Decoration.node(0, 5, { class: "n" }, { id: "n" })]);
    const tr = new Transform(doc);
    tr.wrap(doc.resolve(1).blockRange()!, [{ type: schema.nodes.blockquote }]);
    expect(set.map(tr.mapping, tr.doc, { onRemove: (spec) => removed.push(spec) }).find()).toEqual([]);
    expect(removed).toEqual([{ id: "n" }]);
  });

  it("the node-decoration oracle tells decorations apart, not only ranges", () => {
    const doc = schema.nodes.doc.create(null, [p("a"), p("b")]);
    const original = [Decoration.node(0, 3, { class: "first" }), Decoration.node(3, 6, { class: "second" })];
    const swapped = DecorationSet.create(doc, [Decoration.node(0, 3, { class: "second" }), Decoration.node(3, 6, { class: "first" })]);
    expect(unsoundNodeDecorations(swapped, original, new Mapping(), doc)).toHaveLength(2);
    expect(unsoundNodeDecorations(DecorationSet.create(doc, original), original, new Mapping(), doc)).toEqual([]);
  });
});
