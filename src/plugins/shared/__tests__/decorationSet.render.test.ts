// WI-OC2.2 — the patched decoration tree draws the same DOM as the unpatched
// algorithm (#1565). `decorationSet.differential.test.ts` compares the trees;
// this draws them, through a real EditorView, so a difference the structural
// comparison could miss still shows.
//
// Two comparisons per generated case, over 1000 cases: a widget a wrap moved
// inside a child first failed at seeds above 300. A set the patch built and
// extended draws exactly what the reference algorithm's set draws. Then a
// view that maps the patched set through an edit and redraws incrementally —
// the order in which the view asks `forChild`, hint and all — ends with the
// DOM a fresh view draws for the decorations mapped one by one. Node decorations come
// from the mapped set itself on both sides: upstream drops one whose node
// changed parent on some paths and not others. Each one copied is first held
// to soundness — it covers a node and is, range and identity, what mapping
// one original alone gives (`unsoundNodeDecorations`) — so the copy cannot
// carry a wrong one into the oracle.
//
// Drawings are compared with each `class` attribute's tokens sorted: where
// inline decorations overlap, the view joins their classes in the order the
// set holds them, which differs between a mapped tree and a rebuilt one and
// changes nothing on screen. And the marks a view draws on a selected node
// (`ProseMirror-selectednode`, `draggable`) are dropped: they follow the
// selection, which a dispatched edit can leave on a node and a fresh view
// never draws, not the decorations.
import { afterEach, describe, expect, it } from "vitest";
import type { Node } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { Transform } from "@tiptap/pm/transform";
import { referenceAdd, referenceCreate } from "./decorationSetReference";
import { decorationsOf, documentOf, editsOf, individuallyMapped, isNodeDecoration, schema, seeded, unsoundNodeDecorations } from "./decorationSetFixtures";

const CASES = 1000;

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

/** A view whose decorations follow every transaction by `map`, as a plugin's would. */
function viewOf(doc: Node, decorations: DecorationSet): EditorView {
  const plugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    state: { init: () => decorations, apply: (tr, set) => set.map(tr.mapping, tr.doc) },
    props: { decorations: (state): DecorationSet | undefined => plugin.getState(state) },
  });
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ doc, plugins: [plugin] }),
    editable: () => false,
  });
  views.push(view);
  plugins.set(view, plugin);
  return view;
}

/** Each view's decoration plugin, to read the mapped set back. */
const plugins = new WeakMap<EditorView, Plugin<DecorationSet>>();

/** The view's drawing, class tokens sorted and the selected-node marks dropped. */
function drawing(view: EditorView): string {
  const copy = view.dom.cloneNode(true) as HTMLElement;
  for (const element of copy.querySelectorAll("[draggable]")) element.removeAttribute("draggable");
  for (const element of copy.querySelectorAll("[class]")) {
    const tokens = [...element.classList].filter((token) => token !== "ProseMirror-selectednode").sort();
    if (tokens.length) element.setAttribute("class", tokens.join(" "));
    else element.removeAttribute("class");
  }
  return copy.innerHTML;
}

describe("the patched decoration tree draws what the unpatched algorithm draws", () => {
  it.each(Array.from({ length: CASES }, (_, seed) => seed))("case %i", (seed) => {
    const random = seeded(seed);
    const doc = documentOf(random);
    const first = decorationsOf(doc, random, "a");
    const more = decorationsOf(doc, random, "b");

    const patched = DecorationSet.create(doc, first.slice()).add(doc, more.slice());
    const reference = referenceAdd(referenceCreate(doc, first.slice()), doc, more.slice());
    const drawn = viewOf(doc, patched);
    expect(drawing(drawn), `create+add #${seed}`).toBe(drawing(viewOf(doc, reference)));

    expectRedrawnLikeFresh(drawn, patched, editsOf(doc, random), `map #${seed}`);
  });

  it("wrapping three decorated paragraphs in a quote keeps all three drawn", () => {
    const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
    const doc = schema.nodes.doc.create(null, [p("汉字"), p("かな"), p("中文")]);
    const set = DecorationSet.create(doc, [1, 5, 9].map((from) => Decoration.inline(from, from + 2, { class: "cjk" })));
    const edit = new Transform(doc);
    edit.wrap(doc.resolve(1).blockRange(doc.resolve(11))!, [{ type: schema.nodes.blockquote }]);
    const view = viewOf(doc, set);
    expectRedrawnLikeFresh(view, set, edit, "wrap");
    expect(view.dom.querySelectorAll(".cjk")).toHaveLength(3);
  });

  it("a widget that a wrap moves inside the new quote is drawn before the rule", () => {
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text("a")), schema.nodes.horizontal_rule.create()]);
    const widget = () => Object.assign(document.createElement("span"), { className: "moved" });
    const set = DecorationSet.create(doc, [Decoration.widget(3, widget, { side: 1, key: "w" })]);
    const edit = new Transform(doc);
    edit.wrap(doc.resolve(3).blockRange(doc.resolve(4))!, [{ type: schema.nodes.blockquote }]);
    const view = viewOf(doc, set);
    expectRedrawnLikeFresh(view, set, edit, "wrap widget");
    expect(view.dom.querySelector("blockquote > .moved + hr")).not.toBeNull();
  });
});

/** Apply `edit` to `view`, then compare its drawing with a fresh view of the independently mapped set. */
function expectRedrawnLikeFresh(view: EditorView, before: DecorationSet, edit: Transform, label: string) {
  const tr = view.state.tr;
  for (const step of edit.steps) tr.step(step);
  view.dispatch(tr);
  const mapped = plugins.get(view)!.getState(view.state)!;
  const kept = mapped.find().filter(isNodeDecoration);
  expect(unsoundNodeDecorations(mapped, before.find(), tr.mapping, tr.doc), `${label} node decorations`).toEqual([]);
  const oracle = individuallyMapped(before.find(), tr.mapping, tr.doc).add(tr.doc, kept);
  expect(drawing(view), label).toBe(drawing(viewOf(tr.doc, oracle)));
}
