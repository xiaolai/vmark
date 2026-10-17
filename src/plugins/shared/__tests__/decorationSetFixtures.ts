/**
 * Seeded documents, decoration sets and edits for the decoration-tree tests
 * (#1565): every shape VMark's prosemirror-view patch treats differently, and
 * the oracle a mapped set is held to.
 *
 * Seeded, so a failure names a reproducible case.
 */
import { Schema, type Node } from "@tiptap/pm/model";
import { Transform, type Mapping } from "@tiptap/pm/transform";
import { Decoration, type DecorationSet } from "@tiptap/pm/view";
import { referenceCreate } from "./decorationSetReference";

/** Nesting, leaf blocks, and inline leaves; `toDOM` so a view can draw it too. */
export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    blockquote: { group: "block", content: "block+", toDOM: () => ["blockquote", 0] },
    horizontal_rule: { group: "block", toDOM: () => ["hr"] },
    text: { group: "inline" },
    image: { group: "inline", inline: true, attrs: { src: {} }, toDOM: (node) => ["img", { src: node.attrs.src as string }] },
    hard_break: { group: "inline", inline: true, toDOM: () => ["br"] },
  },
});

/** mulberry32: a small seeded generator. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function documentOf(random: () => number): Node {
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

/** A widget that draws as a span naming its key, so a rendering shows which one it is. */
function widgetDom(key: string) {
  return () => {
    const span = document.createElement("span");
    span.dataset.widget = key;
    return span;
  };
}

export function decorationsOf(doc: Node, random: () => number, tag: string): Decoration[] {
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
    if (roll < 0.42) {
      const from = int(size + 1);
      out.push(Decoration.inline(from, Math.min(size, from + int(12)), attrs));
    } else if (roll < 0.45) {
      // A reversed span — invalid, but the tree must place it as upstream does.
      const to = int(size + 1);
      out.push(Decoration.inline(Math.min(size, to + 1 + int(12)), to, attrs));
    } else if (roll < 0.7 && nodes.length) {
      const { pos, node } = nodes[int(nodes.length)];
      // Now and then a wrong end, which `valid` must drop the same way.
      out.push(Decoration.node(pos, pos + node.nodeSize + (random() < 0.05 ? 1 : 0), attrs));
    } else if (roll < 0.9) {
      const key = `${tag}w${k}`;
      out.push(Decoration.widget(int(size + 1), widgetDom(key), { side: random() < 0.5 ? -1 : 1, key }));
    } else if (out.length) {
      // Same range as an earlier one: the sort must keep their input order.
      const twin = out[int(out.length)];
      out.push(Decoration.inline(twin.from, twin.to, attrs));
    }
  }
  return out;
}

/**
 * One to five steps: insertions of paragraphs and quotes, deletions that cut
 * across block boundaries, and text replacing a range — the compound,
 * structure-changing transactions a mapped tree gets wrong first. A step the
 * schema refuses is skipped.
 */
export function editsOf(doc: Node, random: () => number): Transform {
  const tr = new Transform(doc);
  for (let i = Math.floor(random() * 5); i >= 0; i--) {
    const size = tr.doc.content.size;
    const from = Math.floor(random() * (size + 1));
    const to = Math.min(size, from + Math.floor(random() * 20));
    const roll = random();
    try {
      if (roll < 0.3) tr.insert(from, schema.nodes.paragraph.create(null, schema.text("新")));
      else if (roll < 0.4) tr.insert(from, schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, schema.text("引"))));
      else if (roll < 0.6) tr.replaceWith(from, to, schema.text("汉"));
      else tr.delete(from, to);
    } catch {
      // A step the content expression forbids at this position.
    }
  }
  return tr;
}

/** A decoration's own `map`, which the library keeps off its public types. */
type Mappable = { map(mapping: Mapping, offset: number, oldOffset: number): Decoration | null };

/**
 * What mapping a set must give: each decoration mapped on its own, the way
 * the library maps a decoration it has to gather, then the tree rebuilt.
 * Independent of the tree's structure, so a tree that loses track of where
 * a child's content went cannot agree with it.
 */
export function individuallyMapped(decorations: readonly Decoration[], mapping: Mapping, doc: Node): DecorationSet {
  const mapped = decorations
    .map((decoration) => (decoration as unknown as Mappable).map(mapping, 0, 0))
    .filter((decoration): decoration is Decoration => decoration !== null);
  return referenceCreate(doc, mapped);
}
