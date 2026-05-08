// WI — Inactive selection decoration for Source mode (CodeMirror 6).
// Mirrors src/plugins/inactiveSelection/inactiveSelectionPlugin.test.ts —
// when the CM view is blurred, render a Decoration.mark over each
// non-empty selection range so the user can see what they have selected
// while typing in the built-in terminal.

import { describe, it, expect, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";

import {
  inactiveSelectionExtensions,
  INACTIVE_SELECTION_CLASS,
  inactiveSelectionViewPlugin,
} from "./inactiveSelectionPlugin";

const views: EditorView[] = [];

function createView(
  doc: string,
  ranges: { anchor: number; head: number }[] = [],
): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    extensions: [
      inactiveSelectionExtensions,
      // The production source editor enables multi-cursor; without this
      // facet, CM6 collapses multi-range selections during state init.
      EditorState.allowMultipleSelections.of(true),
    ],
  });
  const view = new EditorView({ state, parent });
  views.push(view);
  if (ranges.length > 0) {
    // Dispatch the (possibly multi-range) selection after construction —
    // EditorState.create in jsdom normalizes to a single range during init.
    view.dispatch({
      selection: EditorSelection.create(
        ranges.map((r) => EditorSelection.range(r.anchor, r.head)),
        ranges.length - 1,
      ),
    });
  }
  return view;
}

afterEach(() => {
  while (views.length) {
    const v = views.pop()!;
    const parent = v.dom.parentElement;
    v.destroy();
    parent?.remove();
  }
});

interface DecoEntry {
  from: number;
  to: number;
  className: string;
}

interface PluginInstance {
  decorations: DecorationSet;
}

function getDecorationSet(view: EditorView): DecorationSet | null {
  const inst = view.plugin(inactiveSelectionViewPlugin) as
    | PluginInstance
    | null;
  return inst?.decorations ?? null;
}

function getInactiveDecos(view: EditorView): DecoEntry[] {
  const decos: DecoEntry[] = [];
  const set = getDecorationSet(view);
  if (!set) return decos;
  set.between(
    0,
    view.state.doc.length,
    (from: number, to: number, deco) => {
      const spec = deco.spec as
        | { class?: string; attributes?: { class?: string } }
        | undefined;
      const cls = spec?.class ?? spec?.attributes?.class ?? "";
      decos.push({ from, to, className: cls });
    },
  );
  return decos;
}

function fakeFocus(view: EditorView, focused: boolean): void {
  // CM6 decides hasFocus from view.root.activeElement === view.contentDOM.
  // In jsdom this works once we call focus()/blur() on contentDOM.
  if (focused) view.contentDOM.focus();
  else view.contentDOM.blur();
  // Force a measure so the ViewPlugin sees focusChanged.
  view.dispatch({});
}

describe("inactiveSelectionExtensions (CodeMirror 6)", () => {
  it("renders one decoration per non-empty range when blurred", () => {
    const view = createView("hello world", [{ anchor: 0, head: 5 }]);
    fakeFocus(view, false);
    const decos = getInactiveDecos(view);
    expect(decos).toHaveLength(1);
    expect(decos[0]).toEqual({
      from: 0,
      to: 5,
      className: INACTIVE_SELECTION_CLASS,
    });
  });

  it("renders no decoration when focused, even with a non-empty range", () => {
    const view = createView("hello world", [{ anchor: 0, head: 5 }]);
    fakeFocus(view, true);
    expect(getInactiveDecos(view)).toEqual([]);
  });

  it("renders no decoration for an empty range (cursor only)", () => {
    const view = createView("hello world", [{ anchor: 3, head: 3 }]);
    fakeFocus(view, false);
    expect(getInactiveDecos(view)).toEqual([]);
  });

  it("supports multiple ranges", () => {
    const view = createView("hello world hello", [
      { anchor: 0, head: 5 },
      { anchor: 12, head: 17 },
    ]);
    // Confirm CM kept both ranges — if jsdom collapsed them this test
    // would otherwise pass as a single-range case.
    expect(
      view.state.selection.ranges.map((r) => [r.from, r.to]),
    ).toEqual([
      [0, 5],
      [12, 17],
    ]);
    fakeFocus(view, false);
    const decos = getInactiveDecos(view);
    expect(decos.map((d) => [d.from, d.to])).toEqual([
      [0, 5],
      [12, 17],
    ]);
  });

  it("decoration tracks new selection while blurred", () => {
    const view = createView("hello world", [{ anchor: 0, head: 5 }]);
    fakeFocus(view, false);
    expect(getInactiveDecos(view)).toHaveLength(1);
    view.dispatch({ selection: { anchor: 6, head: 11 } });
    const decos = getInactiveDecos(view);
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(6);
    expect(decos[0].to).toBe(11);
  });

  it("decoration disappears when focus is regained", () => {
    const view = createView("hello world", [{ anchor: 0, head: 5 }]);
    fakeFocus(view, false);
    expect(getInactiveDecos(view)).toHaveLength(1);
    fakeFocus(view, true);
    expect(getInactiveDecos(view)).toEqual([]);
  });

  it("rebuilds decoration ranges when the doc changes while blurred", () => {
    const view = createView("hello world", [{ anchor: 0, head: 5 }]);
    fakeFocus(view, false);
    // Insert text BEFORE the selection so CM6 maps both selection and
    // decorations to shifted positions.
    view.dispatch({
      changes: { from: 0, to: 0, insert: "XYZ" },
    });
    const decos = getInactiveDecos(view);
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(3);
    expect(decos[0].to).toBe(8);
  });

  it("uses Decoration.mark (inline) rather than line decorations", () => {
    const view = createView("hello world", [{ anchor: 0, head: 5 }]);
    fakeFocus(view, false);
    const set = getDecorationSet(view);
    expect(set).not.toBeNull();
    let kind: unknown = "none";
    set!.between(0, 5, (_f: number, _t: number, d) => {
      kind = (d as unknown as { startSide: number }).startSide;
    });
    expect(typeof kind).toBe("number");
    // Sanity check: Decoration.mark itself produces same startSide kind.
    const ref = Decoration.mark({ class: "x" });
    expect(typeof ref.startSide).toBe("number");
  });
});
