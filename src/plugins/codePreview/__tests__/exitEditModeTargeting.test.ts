// Audit F10 — exitEditMode must not fall back to "the first registered view":
// with multiple editors registered (split panes, preview panes, embedded
// editors), a null-view call could save or revert the edit into the wrong
// document. The caller owns the view that hosts the edit session.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { exitEditMode } from "../editMode";
import { activeEditorViews } from "../pluginState";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";

function makeState(language: string, text: string) {
  const schema = getSchema([StarterKit]);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.codeBlock.create({ language }, schema.text(text)),
  ]);
  return EditorState.create({ schema, doc });
}

describe("exitEditMode view targeting", () => {
  beforeEach(() => {
    activeEditorViews.clear();
    useBlockMathEditingStore.getState().exitEditing();
  });

  it("does nothing without a view, even when other views are registered", () => {
    const state = makeState("latex", "x^2");
    const dispatch = vi.fn();
    const strayView = { state, dispatch, focus: vi.fn() };
    activeEditorViews.add(strayView as never);

    useBlockMathEditingStore.getState().startEditing(0, "x^2");
    exitEditMode(null, false);

    // Must not dispatch into an arbitrary registered view — that view may
    // belong to a different document (split pane / multi-editor).
    expect(dispatch).not.toHaveBeenCalled();
    // The editing session stays untouched; the owning caller must pass its view.
    expect(useBlockMathEditingStore.getState().editingPos).toBe(0);

    useBlockMathEditingStore.getState().exitEditing();
    activeEditorViews.clear();
  });

  it("still saves through an explicitly passed view", () => {
    const state = makeState("latex", "x^2");
    const view = {
      state,
      dispatch: vi.fn(),
      focus: vi.fn(),
    };

    useBlockMathEditingStore.getState().startEditing(0, "x^2");
    exitEditMode(view as never, false);

    expect(view.dispatch).toHaveBeenCalled();
    expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
  });

  it("aborts (clears store, dispatches rebuild) when editingPos is out of bounds", () => {
    const state = makeState("latex", "x^2");
    const view = { state, dispatch: vi.fn(), focus: vi.fn() };

    useBlockMathEditingStore.getState().startEditing(9999, "x^2");
    exitEditMode(view as never, false);

    expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    const tr = view.dispatch.mock.calls[0][0];
    expect(tr.getMeta("codePreviewEditingChanged")).toBe(true);
    // The doc must not have been mutated by the abort.
    expect(view.dispatch.mock.calls[0][0].docChanged).toBe(false);
  });

  it("aborts without mutating when editingPos no longer points at a code block", () => {
    const schema = getSchema([StarterKit]);
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("prose")),
    ]);
    const state = EditorState.create({ schema, doc });
    const view = { state, dispatch: vi.fn(), focus: vi.fn() };

    // Position 0 holds a paragraph, not a code block (doc shifted under a
    // stale edit session).
    useBlockMathEditingStore.getState().startEditing(0, "x^2");
    exitEditMode(view as never, true);

    expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(view.dispatch.mock.calls[0][0].docChanged).toBe(false);
  });
});
