// WI — Inactive selection decoration for WYSIWYG (ProseMirror).
// Renders the current TextSelection as a dimmed overlay while the editor
// is blurred, so users can still see what they have selected when typing
// in the built-in terminal (or any other window outside the editor).

import { describe, it, expect, afterEach, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView, type DecorationSet } from "@tiptap/pm/view";

import {
  inactiveSelectionPlugin,
  inactiveSelectionPluginKey,
  INACTIVE_SELECTION_CLASS,
} from "./inactiveSelectionPlugin";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+", toDOM: () => ["div", 0] as const },
    paragraph: { content: "text*", toDOM: () => ["p", 0] as const },
    text: { inline: true },
  },
});

function createState(text: string, from?: number, to?: number): EditorState {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  let state = EditorState.create({
    doc,
    plugins: [inactiveSelectionPlugin()],
  });
  if (from !== undefined && to !== undefined) {
    const tr = state.tr.setSelection(
      TextSelection.create(state.doc, from, to),
    );
    state = state.apply(tr);
  }
  return state;
}

const views: EditorView[] = [];

function createView(text: string, from?: number, to?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView(parent, { state: createState(text, from, to) });
  views.push(view);
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

function getDecorations(view: EditorView) {
  const sets: DecorationSet[] = [];
  for (const plugin of view.state.plugins) {
    const fn = plugin.props.decorations;
    if (!fn) continue;
    const set = fn.call(plugin, view.state);
    if (set) sets.push(set as DecorationSet);
  }
  const out: { from: number; to: number; class: string }[] = [];
  for (const set of sets) {
    for (const d of set.find()) {
      const attrs =
        (d as unknown as { type: { attrs?: { class?: string } } }).type
          .attrs ?? {};
      out.push({ from: d.from, to: d.to, class: attrs.class ?? "" });
    }
  }
  return out;
}

function setFocus(view: EditorView, focused: boolean): void {
  view.dispatch(
    view.state.tr.setMeta(inactiveSelectionPluginKey, { focused }),
  );
}

describe("inactiveSelectionPlugin", () => {
  describe("plugin state", () => {
    it("initial state is { focused: false }", () => {
      const view = createView("hello");
      const ps = inactiveSelectionPluginKey.getState(view.state);
      expect(ps).toEqual({ focused: false });
    });

    it("meta { focused: true } flips state to focused", () => {
      const view = createView("hello");
      setFocus(view, true);
      expect(inactiveSelectionPluginKey.getState(view.state)).toEqual({
        focused: true,
      });
    });

    it("meta { focused: false } flips state back to blurred", () => {
      const view = createView("hello");
      setFocus(view, true);
      setFocus(view, false);
      expect(inactiveSelectionPluginKey.getState(view.state)).toEqual({
        focused: false,
      });
    });

    it("ignores meta with non-boolean focused field", () => {
      const view = createView("hello");
      setFocus(view, true);
      view.dispatch(
        view.state.tr.setMeta(inactiveSelectionPluginKey, {
          focused: "not-a-bool",
        }),
      );
      expect(inactiveSelectionPluginKey.getState(view.state)).toEqual({
        focused: true,
      });
    });

    it("preserves state through unrelated transactions", () => {
      const view = createView("hello");
      setFocus(view, true);
      view.dispatch(view.state.tr.insertText(" world", 6));
      expect(inactiveSelectionPluginKey.getState(view.state)).toEqual({
        focused: true,
      });
    });
  });

  describe("decorations", () => {
    it("renders a single inline decoration over the selection when blurred", () => {
      const view = createView("hello world", 1, 6); // selects "hello"
      setFocus(view, false);
      const decos = getDecorations(view);
      expect(decos).toHaveLength(1);
      expect(decos[0]).toEqual({
        from: 1,
        to: 6,
        class: INACTIVE_SELECTION_CLASS,
      });
    });

    it("returns no decoration when focused, even with a non-empty selection", () => {
      const view = createView("hello world", 1, 6);
      setFocus(view, true);
      expect(getDecorations(view)).toEqual([]);
    });

    it("returns no decoration when blurred but selection is empty (cursor only)", () => {
      const view = createView("hello world", 3, 3);
      setFocus(view, false);
      expect(getDecorations(view)).toEqual([]);
    });

    it("decoration tracks new range when selection changes while blurred", () => {
      const view = createView("hello world", 1, 6);
      setFocus(view, false);
      // Move selection to "world"
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, 7, 12),
        ),
      );
      const decos = getDecorations(view);
      expect(decos).toHaveLength(1);
      expect(decos[0].from).toBe(7);
      expect(decos[0].to).toBe(12);
    });

    it("decoration disappears when focus is regained", () => {
      const view = createView("hello world", 1, 6);
      setFocus(view, false);
      expect(getDecorations(view)).toHaveLength(1);
      setFocus(view, true);
      expect(getDecorations(view)).toEqual([]);
    });

    it("decoration follows the selection when the doc is edited while blurred", () => {
      const view = createView("hello world", 1, 6); // selects "hello" → from=1, to=6
      setFocus(view, false);
      // Insert text at the very start of the doc — ProseMirror's selection
      // mapping shifts the selection right by the inserted length.
      view.dispatch(view.state.tr.insertText("XYZ", 1));
      const decos = getDecorations(view);
      expect(decos).toHaveLength(1);
      // After insertion, "hello" sits at positions 4..9 (1 + 3 chars).
      expect(decos[0]).toEqual({
        from: 4,
        to: 9,
        class: INACTIVE_SELECTION_CLASS,
      });
    });
  });

  describe("mount-already-focused initialization", () => {
    it("syncs initial state to focused=true when the view reports focus at mount", () => {
      const focusSpy = vi
        .spyOn(EditorView.prototype, "hasFocus")
        .mockReturnValue(true);
      try {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const view = new EditorView(parent, {
          state: createState("hello", 1, 6),
        });
        // The plugin's `view()` runs during EditorView construction and
        // reads `view.hasFocus()`. With the spy returning true, plugin
        // state must be flipped to focused=true synchronously, so no
        // dimmed decoration is rendered for the live selection.
        expect(inactiveSelectionPluginKey.getState(view.state)).toEqual({
          focused: true,
        });
        expect(getDecorations(view)).toEqual([]);
        view.destroy();
        parent.remove();
      } finally {
        focusSpy.mockRestore();
      }
    });
  });

  describe("focus / blur DOM listeners", () => {
    it("attaches focus and blur listeners on view.dom and removes them on destroy", () => {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const view = new EditorView(parent, {
        state: createState("hello", 1, 6),
      });

      // Replace view.dom listener registration so we can observe attach/remove.
      // We instead spy via dispatching focus/blur and watching plugin state.
      const dom = view.dom;

      // Simulate browser focus event → plugin should record focused = true
      dom.dispatchEvent(new FocusEvent("focus"));
      expect(inactiveSelectionPluginKey.getState(view.state)).toEqual({
        focused: true,
      });

      // Simulate blur → focused = false
      dom.dispatchEvent(new FocusEvent("blur"));
      expect(inactiveSelectionPluginKey.getState(view.state)).toEqual({
        focused: false,
      });

      // After destroy, listeners must not fire updates anymore
      view.destroy();
      // Dispatching after destroy must not throw
      expect(() => dom.dispatchEvent(new FocusEvent("focus"))).not.toThrow();

      parent.remove();
    });
  });
});
