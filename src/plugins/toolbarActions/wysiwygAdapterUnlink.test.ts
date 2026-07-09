// WI-4.1 — WYSIWYG "unlink" adapter action: removes the link mark across
// the full link range at a caret, or across the selection; no-ops cleanly
// when there is no link or no link mark in the schema.

import { describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { removeLinkAtCursor } from "./wysiwygAdapterLinks";
import { performWysiwygToolbarAction } from "./wysiwygAdapter";
import type { WysiwygToolbarContext } from "./types";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
  marks: {
    link: {
      attrs: { href: { default: "" } },
      inclusive: false,
    },
  },
});

/** "before [linked] after" — link mark spans "linked" (positions 8-14). */
function createLinkedState(): EditorState {
  const link = schema.marks.link.create({ href: "https://example.com" });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("before "),
      schema.text("linked", [link]),
      schema.text(" after"),
    ]),
  ]);
  return EditorState.create({ doc });
}

interface FakeView {
  state: EditorState;
  dispatch: (tr: unknown) => void;
  focus: () => void;
}

function createView(state: EditorState): FakeView {
  const view: FakeView = {
    state,
    dispatch: vi.fn((tr) => {
      view.state = view.state.apply(tr as never);
    }),
    focus: vi.fn(),
  };
  return view;
}

function contextFor(view: FakeView): WysiwygToolbarContext {
  return {
    surface: "wysiwyg",
    view: view as never,
    editor: null,
    context: null,
  };
}

function linkRuns(state: EditorState): string[] {
  const runs: string[] = [];
  state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "link")) {
      runs.push(node.text ?? "");
    }
  });
  return runs;
}

function caretAt(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

describe("removeLinkAtCursor", () => {
  it("removes the whole link when the caret sits inside it", () => {
    const view = createView(caretAt(createLinkedState(), 11));
    expect(removeLinkAtCursor(contextFor(view))).toBe(true);
    expect(linkRuns(view.state)).toEqual([]);
    expect(view.state.doc.textContent).toBe("before linked after");
    expect(view.focus).toHaveBeenCalled();
  });

  it("removes the whole link when the caret is at the link start boundary", () => {
    const view = createView(caretAt(createLinkedState(), 8));
    expect(removeLinkAtCursor(contextFor(view))).toBe(true);
    expect(linkRuns(view.state)).toEqual([]);
  });

  it("removes the mark across a non-empty selection", () => {
    let state = createLinkedState();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8, 14)));
    const view = createView(state);
    expect(removeLinkAtCursor(contextFor(view))).toBe(true);
    expect(linkRuns(view.state)).toEqual([]);
  });

  it("returns false when the caret is not on a link", () => {
    const view = createView(caretAt(createLinkedState(), 3));
    expect(removeLinkAtCursor(contextFor(view))).toBe(false);
    expect(linkRuns(view.state)).toEqual(["linked"]);
  });

  it("returns false without a view", () => {
    expect(
      removeLinkAtCursor({ surface: "wysiwyg", view: null, editor: null, context: null })
    ).toBe(false);
  });

  it("is routed by performWysiwygToolbarAction as \"unlink\"", () => {
    const view = createView(caretAt(createLinkedState(), 11));
    expect(performWysiwygToolbarAction("unlink", contextFor(view))).toBe(true);
    expect(linkRuns(view.state)).toEqual([]);
  });
});
