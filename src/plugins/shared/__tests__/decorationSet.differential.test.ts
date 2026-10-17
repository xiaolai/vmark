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
import { describe, expect, it } from "vitest";
import { Schema, type Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type DecorationSource } from "@tiptap/pm/view";
import { referenceAdd, referenceCreate, referenceForChild } from "./decorationSetReference";

const CASES = 300;

/** Nesting, leaf blocks, and inline leaves: every shape the tree treats differently. */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    blockquote: { group: "block", content: "block+" },
    horizontal_rule: { group: "block" },
    text: { group: "inline" },
    image: { group: "inline", inline: true, attrs: { src: {} } },
    hard_break: { group: "inline", inline: true },
  },
});

/** mulberry32: a small seeded generator, so a failure names a reproducible case. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function documentOf(random: () => number): Node {
  const int = (n: number) => Math.floor(random() * n);
  const inline = () => {
    const content: Node[] = [];
    for (let i = int(4); i >= 0; i--) {
      const roll = random();
      if (roll < 0.15) content.push(schema.nodes.image.create({ src: "x.png" }));
      else if (roll < 0.25) content.push(schema.nodes.hard_break.create());
      else content.push(schema.text("漢字 kana かな text".slice(0, 1 + int(14))));
    }
    return content;
  };
  const blocks = (depth: number): Node[] => {
    const out: Node[] = [];
    for (let i = int(5); i >= 0; i--) {
      const roll = random();
      if (roll < 0.15 && depth < 3) out.push(schema.nodes.blockquote.create(null, blocks(depth + 1)));
      else if (roll < 0.25) out.push(schema.nodes.horizontal_rule.create());
      else if (roll < 0.35) out.push(schema.nodes.paragraph.create());
      else out.push(schema.nodes.paragraph.create(null, inline()));
    }
    return out;
  };
  return schema.nodes.doc.create(null, blocks(0));
}

const widgetDom = () => document.createElement("span");

function decorationsOf(doc: Node, random: () => number, tag: string): Decoration[] {
  const int = (n: number) => Math.floor(random() * n);
  const size = doc.content.size;
  const nodes: { pos: number; node: Node }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) nodes.push({ pos, node });
  });
  const out: Decoration[] = [];
  for (let k = int(60); k > 0; k--) {
    const roll = random();
    const attrs = { class: `${tag}${k}` };
    if (roll < 0.45) {
      const from = int(size + 1);
      out.push(Decoration.inline(from, Math.min(size, from + int(12)), attrs));
    } else if (roll < 0.7 && nodes.length) {
      const { pos, node } = nodes[int(nodes.length)];
      // Now and then a wrong end, which `valid` must drop the same way.
      out.push(Decoration.node(pos, pos + node.nodeSize + (random() < 0.05 ? 1 : 0), attrs));
    } else if (roll < 0.9) {
      out.push(Decoration.widget(int(size + 1), widgetDom, { side: random() < 0.5 ? -1 : 1, key: `${tag}w${k}` }));
    } else if (out.length) {
      // Same range as an earlier one: the sort must keep their input order.
      const twin = out[int(out.length)];
      out.push(Decoration.inline(twin.from, twin.to, attrs));
    }
  }
  return out;
}

/** A few random insertions and deletions; a step the schema refuses is skipped. */
function editsOf(doc: Node, random: () => number): Transform {
  const tr = new Transform(doc);
  for (let i = Math.floor(random() * 4); i >= 0; i--) {
    const size = tr.doc.content.size;
    const from = Math.floor(random() * (size + 1));
    try {
      if (random() < 0.5) tr.insert(from, schema.nodes.paragraph.create(null, schema.text("新")));
      else tr.delete(from, Math.min(size, from + Math.floor(random() * 20)));
    } catch {
      // An insertion the content expression forbids at this position.
    }
  }
  return tr;
}

function expectSameSet(actual: DecorationSet, expected: DecorationSet, label: string) {
  expect(actual.find(), label).toEqual(expected.find());
  expect((actual as unknown as { eq(o: DecorationSet): boolean }).eq(expected), label).toBe(true);
}

function membersOf(source: DecorationSource): DecorationSet[] {
  const members = (source as unknown as { members?: DecorationSet[] }).members;
  return members ? [...members] : source === DecorationSet.empty ? [] : [source as DecorationSet];
}

/** `forChild` at every child of `node`, recursively, against the reference. */
function expectSameForChild(set: DecorationSet, node: Node, label: string) {
  node.forEach((child, offset) => {
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
  });
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
    expectSameForChild(mapped, tr.doc, `map+forChild #${seed}`);
  });
});
