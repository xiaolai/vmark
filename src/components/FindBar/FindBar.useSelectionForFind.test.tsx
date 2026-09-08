/**
 * WI-FL3.4 — Edit → Use Selection for Find (Mod+E) reaches the bar.
 *
 * `useSearchCommands` relays the native menu event as the DOM CustomEvent
 * `use-selection-for-find`. Nothing listened, so the binding was a no-op. The
 * bar listens: it seeds its query from the focused editor's selection and
 * opens. Real stores throughout — no store mocks — so the assertion is about
 * the store the rest of the app reads, not a hand-written contract.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as CMView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { FindBar } from "./FindBar";

function selectInWysiwyg(text: string): void {
  const editor = {
    state: { selection: { from: 1, to: 1 + text.length }, doc: { textBetween: () => text } },
  } as unknown as TiptapEditor;
  useEditorStore.getState().setActiveWysiwygEditor(editor, "tab-1");
}

function selectInSource(text: string): void {
  const view = {
    state: { selection: { main: { from: 2, to: 2 + text.length } }, sliceDoc: () => text },
  } as unknown as CMView;
  useEditorStore.getState().setActiveSourceView(view, "tab-1");
}

const useSelectionForFind = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent("use-selection-for-find"));
  });

beforeEach(() => {
  useUIStore.getState().searchClose();
  useUIStore.getState().searchSetQuery("");
  useUIStore.getState().setSourceMode(false);
  useEditorStore.getState().clearActiveEditors();
});
afterEach(() => cleanup());

describe("FindBar — use-selection-for-find (WI-FL3.4)", () => {
  it("opens the closed bar with the WYSIWYG selection as the query", () => {
    render(<FindBar />);
    expect(screen.queryByRole("textbox")).toBeNull(); // closed: renders nothing
    selectInWysiwyg("needle");
    useSelectionForFind();
    expect(useUIStore.getState().search.isOpen).toBe(true);
    expect(useUIStore.getState().search.query).toBe("needle");
    expect(screen.getByDisplayValue("needle")).toBeInTheDocument();
  });

  it("replaces the query when the bar is already open", () => {
    useUIStore.getState().searchOpen();
    useUIStore.getState().searchSetQuery("old");
    render(<FindBar />);
    selectInWysiwyg("new");
    useSelectionForFind();
    expect(screen.getByDisplayValue("new")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("old")).toBeNull();
  });

  it("seeds from the Source editor in Source mode", () => {
    useUIStore.getState().setSourceMode(true);
    render(<FindBar />);
    selectInSource("from source");
    useSelectionForFind();
    expect(useUIStore.getState().search.query).toBe("from source");
    expect(screen.getByDisplayValue("from source")).toBeInTheDocument();
  });

  it("with nothing selected it opens the bar and keeps the current query", () => {
    useUIStore.getState().searchSetQuery("kept");
    render(<FindBar />);
    selectInWysiwyg("");
    useSelectionForFind();
    expect(useUIStore.getState().search.isOpen).toBe(true);
    expect(screen.getByDisplayValue("kept")).toBeInTheDocument();
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<FindBar />);
    unmount();
    selectInWysiwyg("needle");
    useSelectionForFind();
    expect(useUIStore.getState().search.isOpen).toBe(false);
  });
});
