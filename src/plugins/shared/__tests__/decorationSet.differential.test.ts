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
// `mapChildren`, which in a multi-step mapping could keep a child whose opening
// token a later step had replaced, and leave the decorations after the cut
// unshifted — so for `map`, upstream is not the reference.
import { describe, expect, it } from "vitest";
import type { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type DecorationSource } from "@tiptap/pm/view";
import { referenceAdd, referenceCreate, referenceForChild } from "./decorationSetReference";
import { decorationsOf, documentOf, editsOf, individuallyMapped, schema, seeded } from "./decorationSetFixtures";

const CASES = 300;

function expectSameSet(actual: DecorationSet, expected: DecorationSet, label: string) {
  expect(actual.find(), label).toEqual(expected.find());
  expect((actual as unknown as { eq(o: DecorationSet): boolean }).eq(expected), label).toBe(true);
}

/** A decoration as a comparable line: where, what kind, which one. */
function lineOf(d: Decoration): string {
  const { widget, inline } = d as unknown as { widget: boolean; inline: boolean };
  const kind = widget ? "widget" : inline ? "inline" : "node";
  const label = (d.spec as { key?: string }).key ?? JSON.stringify((d as unknown as { type: { attrs?: object } }).type.attrs);
  return `${d.from}-${d.to} ${kind} ${label}`;
}

function expectSameDecorations(actual: DecorationSet, expected: DecorationSet, label: string) {
  expect(actual.find().map(lineOf).sort(), label).toEqual(expected.find().map(lineOf).sort());
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
    expectSameDecorations(mapped, individuallyMapped(added.find(), tr.mapping, tr.doc), `map #${seed}`);
    expectSameForChild(mapped, tr.doc, `map+forChild #${seed}`);
  });
});

describe("cases the audit found", () => {
  const p = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const quote = (...blocks: Node[]) => schema.nodes.blockquote.create(null, blocks);

  it("a later step that replaces a touched child's opening token", () => {
    // Step 1 replaces the last paragraph, touching the second quote at its
    // end; step 2 deletes from that quote's start into its first paragraph,
    // and the fitter re-creates the quote. The quote is not the same node.
    const doc = schema.nodes.doc.create(null, [quote(p("汉字かなA"), p("ABC")), quote(p("A 中文 B"), p("汉字かなA")), p("中文")]);
    const set = DecorationSet.create(doc, [Decoration.inline(24, 28, { class: "cjk" }), Decoration.inline(2, 6, { class: "cjk" })]);
    const tr = new Transform(doc).replaceWith(31, 35, schema.text("汉")).delete(14, 20);
    expectSameDecorations(set.map(tr.mapping, tr.doc), individuallyMapped(set.find(), tr.mapping, tr.doc), "compound edit");
  });
});
