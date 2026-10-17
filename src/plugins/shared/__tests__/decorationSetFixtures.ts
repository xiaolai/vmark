/**
 * Seeded documents, decoration sets and edits for the decoration-tree tests
 * (#1565): every shape VMark's prosemirror-view patch treats differently, and
 * the oracle a mapped set is held to.
 *
 * Seeded, so a failure names a reproducible case.
 */
import { Schema, type Node } from "@tiptap/pm/model";
import { Transform, findWrapping, liftTarget, type Mapping } from "@tiptap/pm/transform";
import { Decoration, type DecorationSet, type DecorationSource } from "@tiptap/pm/view";
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
 * across block boundaries, text replacing a range, and blocks wrapped in a
 * quote or lifted out of one (`ReplaceAroundStep`) — the compound,
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
      if (roll < 0.22) tr.insert(from, schema.nodes.paragraph.create(null, schema.text("新")));
      else if (roll < 0.3) tr.insert(from, schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, schema.text("引"))));
      else if (roll < 0.45) tr.replaceWith(from, to, schema.text("汉"));
      else if (roll < 0.6) {
        const range = tr.doc.resolve(from).blockRange(tr.doc.resolve(to));
        const wrapping = range && findWrapping(range, schema.nodes.blockquote);
        if (range && wrapping) tr.wrap(range, wrapping);
      } else if (roll < 0.72) {
        const range = tr.doc.resolve(from).blockRange(tr.doc.resolve(to));
        const target = range && liftTarget(range);
        if (range && target != null) tr.lift(range, target);
      } else tr.delete(from, to);
    } catch {
      // A step the content expression forbids at this position.
    }
  }
  return tr;
}

/** One character typed somewhere inside a textblock: an edit that moves no node. */
export function typedIn(doc: Node, random: () => number): Transform | null {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) for (let i = 0; i <= node.content.size; i++) positions.push(pos + 1 + i);
  });
  if (!positions.length) return null;
  return new Transform(doc).insert(positions[Math.floor(random() * positions.length)], schema.text("字"));
}

/** A decoration's own `map` and kind, which the library keeps off its public types. */
type Internals = { map(mapping: Mapping, offset: number, oldOffset: number): Decoration | null; inline: boolean; widget: boolean };
const internals = (decoration: Decoration) => decoration as unknown as Internals;

/** A node decoration: neither inline nor a widget. */
export const isNodeDecoration = (decoration: Decoration) => !internals(decoration).inline && !internals(decoration).widget;

/**
 * What mapping a set must give its inline decorations and widgets: each one
 * mapped on its own, the way the library maps a decoration it has to gather,
 * then the tree rebuilt. Independent of the tree's structure, so a tree that
 * loses track of where a child's content went cannot agree with it.
 *
 * Node decorations are left out: upstream drops one whose node now sits under
 * a different parent (`mapInner` checks it against its own level) but keeps
 * one it gathered and rebuilt, so whether it survives depends on the path the
 * mapping took. They are held to soundness instead (`unsoundNodeDecorations`).
 */
export function individuallyMapped(decorations: readonly Decoration[], mapping: Mapping, doc: Node): DecorationSet {
  const mapped = decorations
    .filter((decoration) => !isNodeDecoration(decoration))
    .map((decoration) => internals(decoration).map(mapping, 0, 0))
    .filter((decoration): decoration is Decoration => decoration !== null);
  return referenceCreate(doc, mapped);
}

/**
 * Node decorations of a mapped set that do not belong there: one that covers
 * no node exactly, or that is not — range AND identity — what mapping one of
 * the originals on its own gives, each original used once. Empty for a sound
 * set; a sound set may still have dropped some (`nodeLines` checks those).
 */
export function unsoundNodeDecorations(mapped: DecorationSource, original: readonly Decoration[], mapping: Mapping, doc: Node): string[] {
  const allowed = new Map<string, number>();
  for (const line of nodeLines(individuallyMappedNodes(original, mapping))) allowed.set(line, (allowed.get(line) ?? 0) + 1);
  const found: Decoration[] = [];
  mapped.forEachSet((set) => found.push(...set.find()));
  return found
    .filter(isNodeDecoration)
    .filter((decoration) => {
      const node = doc.nodeAt(decoration.from);
      const line = lineOf(decoration);
      const left = allowed.get(line) ?? 0;
      if (left) allowed.set(line, left - 1);
      return !node || node.isText || decoration.from + node.nodeSize !== decoration.to || !left;
    })
    .map((decoration) => lineOf(decoration));
}

/** The node decorations among `decorations`, each mapped on its own. */
export function individuallyMappedNodes(decorations: readonly Decoration[], mapping: Mapping): Decoration[] {
  return decorations
    .filter(isNodeDecoration)
    .map((decoration) => internals(decoration).map(mapping, 0, 0))
    .filter((decoration): decoration is Decoration => decoration !== null);
}

/** The node decorations among `decorations` as sorted lines. */
export function nodeLines(decorations: readonly Decoration[]): string[] {
  return decorations.filter(isNodeDecoration).map((decoration) => lineOf(decoration)).sort();
}

/** A decoration as a comparable line: where, what kind, which one. */
function lineOf(decoration: Decoration, base = 0): string {
  const { inline, widget } = internals(decoration);
  const kind = widget ? "widget" : inline ? "inline" : "node";
  const label = (decoration.spec as { key?: string }).key ?? JSON.stringify((decoration as unknown as { type: { attrs?: object } }).type.attrs);
  return `${base + decoration.from}-${base + decoration.to} ${kind} ${label}`;
}

/**
 * What a view draws from `source` over `node`, as lines: descending the way
 * the view does — `forChild` per child — so a subtree the tree keeps under
 * the wrong parent, which `find()` still lists, is missing here. Inline
 * decorations are read where text is drawn (a textblock), widgets where they
 * sit, node decorations only on a child they exactly cover.
 */
export function drawn(source: DecorationSource, node: Node, base = 0, out: string[] = []): string[] {
  const locals: Decoration[] = [];
  source.forEachSet((set) => locals.push(...(set as unknown as { local: readonly Decoration[] }).local));
  const children: { child: Node; offset: number }[] = [];
  node.forEach((child, offset) => children.push({ child, offset }));
  for (const decoration of locals) {
    if (internals(decoration).widget) out.push(lineOf(decoration, base));
    else if (internals(decoration).inline) {
      if (node.inlineContent) out.push(lineOf(decoration, base));
    } else if (children.some(({ child, offset }) => offset === decoration.from && offset + child.nodeSize === decoration.to)) {
      out.push(lineOf(decoration, base));
    }
  }
  for (const { child, offset } of children) {
    if (!child.isLeaf) drawn(source.forChild(offset, child), child, base + offset + 1, out);
  }
  return out;
}
