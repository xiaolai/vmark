// @vitest-environment node
/**
 * Incremental CJK decorations must always equal a fresh full scan, including
 * after transactions that change the document's STRUCTURE (#1565 audit).
 *
 * The named case is the one the audit found: a decoration set mapped through
 * a compound transaction kept stale positions inside a blockquote, a bug in
 * prosemirror-view's `mapChildren` that VMark's patch fixes. The seeded cases
 * hold the whole class — any edit, any structure, every transaction compared
 * with a fresh scan — so the next instance cannot pass as a one-off.
 */

import { describe, it, expect } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Plugin } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { CJKLetterSpacing } from "../plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    blockquote: { group: "block", content: "block+" },
    text: {},
  },
});

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const quote = (...blocks: PMNode[]) => schema.node("blockquote", null, blocks);

function createPlugin(): Plugin {
  const plugins = CJKLetterSpacing.config.addProseMirrorPlugins!.call({
    name: "cjkLetterSpacing",
    options: { className: "cjk-spacing", isEnabled: () => true },
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  } as never) as Plugin[];
  return plugins[0];
}

const CJK = /[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯㄀-ㄯ]+/g;

/** Every CJK run in `doc`, as a fresh scan finds them. */
function runsOf(doc: PMNode): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(CJK)) runs.push([pos + m.index, pos + m.index + m[0].length]);
  });
  return runs;
}

function decorated(state: EditorState, plugin: Plugin): Array<[number, number]> {
  const set = (plugin.getState(state) as { decorations: DecorationSet }).decorations;
  return set
    .find()
    .map((d) => [d.from, d.to] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe("incremental CJK decorations after structural edits", () => {
  it("a delete that cuts into a blockquote, after a replace at the end", () => {
    const plugin = createPlugin();
    const doc = schema.node("doc", null, [
      quote(p("汉字かなA"), p("ABC")),
      quote(p("A 中文 B"), p("汉字かなA")),
      p("中文"),
    ]);
    let state = EditorState.create({ doc, plugins: [plugin] });
    state = state.apply(state.tr.insertText("汉", 31, 35).delete(14, 20));

    expect(decorated(state, plugin)).toEqual(runsOf(state.doc));
  });

  /** mulberry32, so a failing case names its seed. */
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

  const TEXTS = ["汉字かなA", "ABC", "A 中文 B", "中文", "한글 text", "", "かな漢字かな"];

  function randomDoc(random: () => number): PMNode {
    const int = (n: number) => Math.floor(random() * n);
    const blocks = (depth: number): PMNode[] =>
      Array.from({ length: 1 + int(4) }, () =>
        depth < 2 && random() < 0.3 ? quote(...blocks(depth + 1)) : p(TEXTS[int(TEXTS.length)]));
    return schema.node("doc", null, blocks(0));
  }

  /** One to four steps that insert, replace, delete across blocks, split and join. */
  function randomEdit(state: EditorState, random: () => number): Transaction {
    const tr = state.tr;
    const int = (n: number) => Math.floor(random() * n);
    for (let i = int(4); i >= 0; i--) {
      const size = tr.doc.content.size;
      const from = int(size + 1);
      const to = Math.min(size, from + int(12));
      const roll = random();
      try {
        if (roll < 0.25) tr.insertText(["汉", "a", "かな", " "][int(4)], from, random() < 0.5 ? from : to);
        else if (roll < 0.5) tr.delete(from, to);
        else if (roll < 0.65) tr.split(from);
        else if (roll < 0.8) tr.join(from);
        else tr.insert(from, random() < 0.5 ? p("新しい") : quote(p("引用")));
      } catch {
        // A step this position does not allow.
      }
    }
    return tr;
  }

  it.each(Array.from({ length: 200 }, (_, seed) => seed))("seeded edits, case %i", (seed) => {
    const random = seeded(seed);
    const plugin = createPlugin();
    let state = EditorState.create({ doc: randomDoc(random), plugins: [plugin] });
    for (let round = 0; round < 6; round++) {
      state = state.apply(randomEdit(state, random));
      expect(decorated(state, plugin), `case ${seed}, transaction ${round}`).toEqual(runsOf(state.doc));
    }
  });
});
