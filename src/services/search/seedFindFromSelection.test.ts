// @vitest-environment node
/**
 * WI-FL3.4 — Edit → Use Selection for Find (Mod+E) seeds the find bar.
 *
 * Real uiStore throughout; the focused editor is a minimal Tiptap stand-in
 * registered on the real editorStore.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { findQueryFromSelection, seedFindFromSelection } from "./seedFindFromSelection";

function selectInWysiwyg(text: string): void {
  const editor = {
    state: { selection: { from: 1, to: 1 + text.length }, doc: { textBetween: () => text } },
  } as unknown as TiptapEditor;
  useEditorStore.getState().setActiveWysiwygEditor(editor, "tab-1");
}

beforeEach(() => {
  const ui = useUIStore.getState();
  ui.searchClose();
  ui.searchSetQuery("");
  ui.setStatusBarVisible(true);
  ui.setUniversalToolbarVisible(false);
});
afterEach(() => useEditorStore.getState().clearActiveEditors());

describe("findQueryFromSelection", () => {
  it.each([
    ["", ""],
    ["needle", "needle"],
    [" spaced ", " spaced "],
    ["first\nsecond", "first"],
    ["first\r\nsecond", "first"],
    ["\nleading break", ""],
  ])("%j → %j (the bar matches within a block, so only the first line can be a query)", (input, expected) => {
    expect(findQueryFromSelection(input)).toBe(expected);
  });
});

describe("seedFindFromSelection", () => {
  it("opens a closed bar with the selection as the query, displacing the status bar and hiding the toolbar", () => {
    useUIStore.getState().setUniversalToolbarVisible(true);
    selectInWysiwyg("needle");
    seedFindFromSelection();
    const ui = useUIStore.getState();
    expect(ui.search.isOpen).toBe(true);
    expect(ui.search.query).toBe("needle");
    expect(ui.statusBarVisible).toBe(false);
    expect(ui.universalToolbarVisible).toBe(false);
  });

  it("replaces the query of an already-open bar and leaves the chrome alone", () => {
    useUIStore.getState().searchOpen();
    useUIStore.getState().searchSetQuery("old");
    useUIStore.getState().setUniversalToolbarVisible(true);
    selectInWysiwyg("new");
    seedFindFromSelection();
    const ui = useUIStore.getState();
    expect(ui.search.isOpen).toBe(true);
    expect(ui.search.query).toBe("new");
    expect(ui.statusBarVisible).toBe(true);
    expect(ui.universalToolbarVisible).toBe(true);
  });

  it("with nothing selected it still opens the bar and keeps the current query", () => {
    useUIStore.getState().searchSetQuery("kept");
    selectInWysiwyg("");
    seedFindFromSelection();
    expect(useUIStore.getState().search.isOpen).toBe(true);
    expect(useUIStore.getState().search.query).toBe("kept");
  });

  it("uses only the first line of a multi-line selection", () => {
    selectInWysiwyg("first line\nsecond line");
    seedFindFromSelection();
    expect(useUIStore.getState().search.query).toBe("first line");
  });

  it("resets the match cursor so navigation starts from the new query", () => {
    useUIStore.getState().searchOpen();
    useUIStore.getState().searchSetQuery("old");
    useUIStore.getState().searchSetMatches(3, 2);
    selectInWysiwyg("new");
    seedFindFromSelection();
    expect(useUIStore.getState().search.currentIndex).toBe(-1);
  });
});
