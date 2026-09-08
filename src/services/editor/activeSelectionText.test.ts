// @vitest-environment node
/**
 * readActiveSelectionText — the focused editor's selected text, on whichever
 * surface is live. The markdown split mounts BOTH editors, so when the mode's
 * editor has no selection the other surface's selection is used.
 *
 * Real stores; the editors are minimal stand-ins for the two selection APIs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as CMView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { readActiveSelectionText } from "./activeSelectionText";

function fakeTiptap(selected: string, opts: { focused?: boolean; span?: number } = {}) {
  const from = 1;
  const to = from + (opts.span ?? selected.length);
  const textBetween = vi.fn(() => selected);
  const editor = {
    isFocused: opts.focused ?? false,
    state: { selection: { from, to }, doc: { textBetween } },
  } as unknown as TiptapEditor;
  return { editor, textBetween, from, to };
}

function fakeSource(selected: string, opts: { focused?: boolean } = {}) {
  const from = 3;
  const to = from + selected.length;
  const sliceDoc = vi.fn(() => selected);
  const view = {
    hasFocus: opts.focused ?? false,
    state: { selection: { main: { from, to } }, sliceDoc },
  } as unknown as CMView;
  return { view, sliceDoc, from, to };
}

afterEach(() => {
  useEditorStore.getState().clearActiveEditors();
  useUIStore.getState().setSourceMode(false);
});

describe("readActiveSelectionText", () => {
  it("is empty when no editor is active", () => {
    expect(readActiveSelectionText()).toBe("");
  });

  it("WYSIWYG: reads the selected range as plain text with a space block separator", () => {
    const { editor, textBetween, from, to } = fakeTiptap("needle");
    useEditorStore.getState().setActiveWysiwygEditor(editor, "tab-1");
    expect(readActiveSelectionText()).toBe("needle");
    expect(textBetween).toHaveBeenCalledWith(from, to, " ");
  });

  it("WYSIWYG: a collapsed selection is empty and never asks the document", () => {
    const { editor, textBetween } = fakeTiptap("");
    useEditorStore.getState().setActiveWysiwygEditor(editor, "tab-1");
    expect(readActiveSelectionText()).toBe("");
    expect(textBetween).not.toHaveBeenCalled();
  });

  it("Source mode: reads the CodeMirror main selection", () => {
    useUIStore.getState().setSourceMode(true);
    const { view, sliceDoc, from, to } = fakeSource("needle");
    useEditorStore.getState().setActiveSourceView(view, "tab-1");
    expect(readActiveSelectionText()).toBe("needle");
    expect(sliceDoc).toHaveBeenCalledWith(from, to);
  });

  it("Source mode: a collapsed selection is empty", () => {
    useUIStore.getState().setSourceMode(true);
    useEditorStore.getState().setActiveSourceView(fakeSource("").view, "tab-1");
    expect(readActiveSelectionText()).toBe("");
  });

  it("falls back to the source pane when WYSIWYG has no selection (markdown split)", () => {
    useEditorStore.getState().setActiveWysiwygEditor(fakeTiptap("").editor, "tab-1");
    useEditorStore.getState().setActiveSourceView(fakeSource("from source").view, "tab-1");
    expect(readActiveSelectionText()).toBe("from source");
  });

  it("falls back to WYSIWYG when the source pane has no selection in Source mode", () => {
    useUIStore.getState().setSourceMode(true);
    useEditorStore.getState().setActiveSourceView(fakeSource("").view, "tab-1");
    useEditorStore.getState().setActiveWysiwygEditor(fakeTiptap("from wysiwyg").editor, "tab-1");
    expect(readActiveSelectionText()).toBe("from wysiwyg");
  });

  it("prefers the live mode's surface when both editors have a selection", () => {
    useEditorStore.getState().setActiveWysiwygEditor(fakeTiptap("wysiwyg").editor, "tab-1");
    useEditorStore.getState().setActiveSourceView(fakeSource("source").view, "tab-1");
    expect(readActiveSelectionText()).toBe("wysiwyg");
    useUIStore.getState().setSourceMode(true);
    expect(readActiveSelectionText()).toBe("source");
  });

  // Audit 20260907 (#468): `sourceMode` names the display MODE, not the focused
  // pane — the markdown split mounts both editors with sourceMode false, so a
  // retained WYSIWYG selection won over the source pane the user was typing in.
  it("split view: the FOCUSED editor wins over the mode's editor when both have a selection", () => {
    useEditorStore.getState().setActiveWysiwygEditor(fakeTiptap("stale wysiwyg").editor, "tab-1");
    useEditorStore
      .getState()
      .setActiveSourceView(fakeSource("live source", { focused: true }).view, "tab-1");
    expect(readActiveSelectionText()).toBe("live source");
  });

  it("Source mode: a focused WYSIWYG editor wins the same way", () => {
    useUIStore.getState().setSourceMode(true);
    useEditorStore.getState().setActiveSourceView(fakeSource("stale source").view, "tab-1");
    useEditorStore
      .getState()
      .setActiveWysiwygEditor(fakeTiptap("live wysiwyg", { focused: true }).editor, "tab-1");
    expect(readActiveSelectionText()).toBe("live wysiwyg");
  });

  // Audit 20260907 (#469): a NODE selection (an image, a horizontal rule) is a
  // real, non-collapsed selection whose text is "" — it must not read as "no
  // selection" and hand the answer to the other surface.
  it("a non-collapsed selection with no text is a selection, not a fallback", () => {
    const { editor, textBetween } = fakeTiptap("", { span: 1 });
    useEditorStore.getState().setActiveWysiwygEditor(editor, "tab-1");
    useEditorStore.getState().setActiveSourceView(fakeSource("other pane").view, "tab-1");
    expect(readActiveSelectionText()).toBe("");
    expect(textBetween).toHaveBeenCalled();
  });

  // Audit 20260907 (#470): the fallback crossed surfaces without checking the
  // registered tab, so a stale source view from another tab supplied the text.
  it("never falls back to the other surface when it belongs to a different tab", () => {
    useEditorStore.getState().setActiveWysiwygEditor(fakeTiptap("").editor, "tab-1");
    useEditorStore.getState().setActiveSourceView(fakeSource("from tab-2").view, "tab-2");
    expect(readActiveSelectionText()).toBe("");
  });
});
