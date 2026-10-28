// @vitest-environment node
// WI-AL1.4 — Block correspondence: a current block pairs with an anchored one only when it maps back through every observed step to the same immutable node and no observed step touched its interior. Covered: no edges (identity), an edit inside a block, a block inserted at a boundary (its neighbours still pair), a block deleted, a chain of edges whose earlier touched ranges are carried through later maps, empty-map mark and attribute steps, a reorder (the moved block never pairs), text changed and changed back (still touched), CJK and astral text, pairs ascending in both documents, and the range-mapping budget (touched propagation and every block's inverse edge mapping together) failing closed with null.
import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { correspond } from "../pmCorrespondence";
import { rangeCount } from "../pmSteps";
import { TxnLedger, observerPlugin } from "../txnLedger";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", attrs: { align: { default: null } } },
    text: {},
  },
  marks: { strong: {} },
});

const docOf = (...texts: string[]) => schema.node("doc", null, texts.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])));
/** Where block `i`'s content starts. */
const inside = (d: PMNode, i: number) => {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += d.child(k).nodeSize;
  return pos + 1;
};
const blockStart = (d: PMNode, i: number) => inside(d, i) - 1;

/** Run `edits` (one transaction each) from `texts` under a ledger; the pairs it proves. */
function pairsAfter(texts: string[], ...edits: ((s: EditorState) => Transaction)[]) {
  const ledger = new TxnLedger();
  let state = EditorState.create({ schema, doc: docOf(...texts), plugins: [observerPlugin(ledger)] });
  const anchored = state.doc;
  const from = ledger.boundary(state);
  for (const edit of edits) state = state.apply(edit(state));
  const chain = ledger.chain(from, state);
  if (!chain.ok) throw new Error(`chain failed: ${chain.reason}`);
  return { pairs: correspond(anchored, state.doc, chain.edges), current: state.doc, anchored, edges: chain.edges };
}

describe("correspond", () => {
  it("with no edges, every block pairs with itself", () => {
    expect(pairsAfter(["a", "b", "c"]).pairs).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it("an edit inside a block unpairs that block only", () => {
    expect(pairsAfter(["aa", "bb", "cc"], (s) => s.tr.insertText("X", inside(s.doc, 1) + 1)).pairs).toEqual([[0, 0], [2, 2]]);
  });

  it("a block inserted at a boundary leaves both neighbours paired", () => {
    const { pairs } = pairsAfter(["aa", "bb"], (s) => s.tr.insert(blockStart(s.doc, 1), schema.node("paragraph", null, [schema.text("new")])));
    expect(pairs).toEqual([[0, 0], [1, 2]]);
  });

  it("a block deleted leaves its neighbours paired across the gap", () => {
    const { pairs } = pairsAfter(["aa", "bb", "cc"], (s) => s.tr.delete(blockStart(s.doc, 1), blockStart(s.doc, 2)));
    expect(pairs).toEqual([[0, 0], [2, 1]]);
  });

  it("carries an earlier edge's touched range through a later edge's maps", () => {
    const { pairs } = pairsAfter(
      ["aa", "bb", "cc", "dd"],
      (s) => s.tr.insertText("X", inside(s.doc, 2)),
      (s) => s.tr.insert(0, schema.node("paragraph", null, [schema.text("top")])),
    );
    expect(pairs).toEqual([[0, 1], [1, 2], [3, 4]]);
  });

  it("an empty-map mark step unpairs the block it marks", () => {
    const { pairs, edges } = pairsAfter(["aa", "bb"], (s) => s.tr.addMark(inside(s.doc, 0), inside(s.doc, 0) + 1, schema.marks.strong.create()));
    expect(edges[0].maps.map(rangeCount)).toEqual([0]);
    expect(pairs).toEqual([[1, 1]]);
  });

  it("an attribute step unpairs the block it changes", () => {
    expect(pairsAfter(["aa", "bb"], (s) => s.tr.setNodeAttribute(blockStart(s.doc, 1), "align", "center")).pairs).toEqual([[0, 0]]);
  });

  it("a reordered block never pairs; the others keep ascending pairs", () => {
    const { pairs, current, anchored } = pairsAfter(["aa", "bb", "cc"], (s) => {
      const moved = s.doc.child(0);
      return s.tr.delete(0, moved.nodeSize).insert(s.doc.content.size - moved.nodeSize, moved);
    });
    // The very node object moved: only the touched range keeps it from pairing.
    expect(current.child(2)).toBe(anchored.child(0));
    expect(current.textContent).toBe("bbccaa");
    expect(pairs).toEqual([[1, 0], [2, 1]]);
  });

  it("text changed and changed back is still touched", () => {
    const { pairs, current, anchored } = pairsAfter(
      ["aa", "bb"],
      (s) => s.tr.insertText("X", inside(s.doc, 0)),
      (s) => s.tr.delete(inside(s.doc, 0), inside(s.doc, 0) + 1),
    );
    expect(current.eq(anchored)).toBe(true);
    expect(pairs).toEqual([[1, 1]]);
  });

  it("CJK and astral text map by UTF-16 positions", () => {
    const { pairs } = pairsAfter(["读书", "😀😀", "末"], (s) => s.tr.insertText("中", inside(s.doc, 1) + 2));
    expect(pairs).toEqual([[0, 0], [2, 2]]);
  });

  it("an empty block pairs like any other", () => {
    expect(pairsAfter(["", "bb", ""], (s) => s.tr.insertText("X", inside(s.doc, 1))).pairs).toEqual([[0, 0], [2, 2]]);
  });

  it("pairs ascend in both documents", () => {
    const { pairs } = pairsAfter(
      ["a", "b", "c", "d", "e"],
      (s) => s.tr.insertText("X", inside(s.doc, 1)),
      (s) => s.tr.delete(blockStart(s.doc, 3), blockStart(s.doc, 4)),
    );
    expect(pairs).toEqual([[0, 0], [2, 2], [4, 3]]);
    for (let i = 1; i < pairs!.length; i++) {
      expect(pairs![i][0]).toBeGreaterThan(pairs![i - 1][0]);
      expect(pairs![i][1]).toBeGreaterThan(pairs![i - 1][1]);
    }
  });

  it("past the range-mapping budget it pairs nothing (null), never a partial answer", () => {
    // Three edits at disjoint places: carrying the earlier ranges costs 0 + 1 + 2 = 3 mappings,
    // and mapping the one untouched block's two edges back through three maps costs 6 more.
    const edits = [0, 1, 2].map((i) => (s: EditorState) => s.tr.insertText("X", inside(s.doc, i)));
    const { anchored, current, edges } = pairsAfter(["aa", "bb", "cc", "dd"], ...edits);
    expect(correspond(anchored, current, edges, 9)).toEqual([[3, 3]]);
    expect(correspond(anchored, current, edges, 8)).toBeNull();
  });

  it("charges mapping every block's edges back through every map to the same budget", () => {
    // Twenty edits in the first block touch one range; the 199 blocks after it cost 2 × 20 maps each.
    const edits = Array.from({ length: 20 }, () => (s: EditorState) => s.tr.insertText("X", inside(s.doc, 0)));
    const { anchored, current, edges } = pairsAfter(Array.from({ length: 200 }, (_, i) => `b${i}`), ...edits);
    expect(correspond(anchored, current, edges, 1000)).toBeNull();
    expect(correspond(anchored, current, edges)).toHaveLength(199);
  });
});
