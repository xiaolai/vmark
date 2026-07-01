import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useFocusedPaneTiptapRegistration } from "./useFocusedPaneTiptapRegistration";
import { usePaneStore } from "@/stores/paneStore";
import { useEditorStore } from "@/stores/editorStore";
import { PaneProvider } from "@/contexts/PaneContext";
import type { PaneId } from "@/stores/paneStore";

const W = "main";

/** Minimal Tiptap stand-in: setTiptapEditor only reads `.view`. */
function fakeEditor(id: string): TiptapEditor {
  return { view: { id } } as unknown as TiptapEditor;
}

function paneWrapper(paneId: PaneId) {
  return ({ children }: { children: ReactNode }) => (
    <PaneProvider value={{ paneId, tabId: `${paneId}-tab` }}>{children}</PaneProvider>
  );
}

const opts = (editor: TiptapEditor, over: Partial<{ hidden: boolean; preview: boolean }> = {}) => ({
  hidden: false,
  preview: false,
  activeTabId: "tab-1",
  windowLabel: W,
  ...over,
});

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useEditorStore.getState().clearTiptap();
  useEditorStore.getState().clearActiveEditors();
});

describe("useFocusedPaneTiptapRegistration (#1081 — ADR-3)", () => {
  it("registers the editor when visible and focused (single pane)", () => {
    const ed = fakeEditor("A");
    renderHook(() => useFocusedPaneTiptapRegistration(ed, opts(ed)));
    expect(useEditorStore.getState().tiptap.editor).toBe(ed);
    expect(useEditorStore.getState().active.activeWysiwygEditor).toBe(ed);
  });

  it("does NOT register when hidden", () => {
    const ed = fakeEditor("A");
    renderHook(() => useFocusedPaneTiptapRegistration(ed, opts(ed, { hidden: true })));
    expect(useEditorStore.getState().tiptap.editor).toBeNull();
  });

  it("does NOT register when preview", () => {
    const ed = fakeEditor("A");
    renderHook(() => useFocusedPaneTiptapRegistration(ed, opts(ed, { preview: true })));
    expect(useEditorStore.getState().tiptap.editor).toBeNull();
  });

  it("an unfocused split pane does not clobber the focused pane's registration", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const ed = fakeEditor("primary");
    renderHook(() => useFocusedPaneTiptapRegistration(ed, opts(ed)), {
      wrapper: paneWrapper("primary"),
    });
    // Primary pane is unfocused → it must not register itself.
    expect(useEditorStore.getState().tiptap.editor).toBeNull();
  });

  it("the focused split pane registers its editor", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const ed = fakeEditor("secondary");
    renderHook(() => useFocusedPaneTiptapRegistration(ed, opts(ed)), {
      wrapper: paneWrapper("secondary"),
    });
    expect(useEditorStore.getState().tiptap.editor).toBe(ed);
  });

  it("cleanup is identity-guarded: unmounting a stale pane won't null a newer registration", () => {
    const edA = fakeEditor("A");
    const { unmount } = renderHook(() => useFocusedPaneTiptapRegistration(edA, opts(edA)));
    expect(useEditorStore.getState().tiptap.editor).toBe(edA);

    // A different editor becomes the registered one (focus moved to the other pane).
    const edB = fakeEditor("B");
    useEditorStore.getState().setTiptapEditor(edB);

    // Unmounting A's hook must not clear B.
    unmount();
    expect(useEditorStore.getState().tiptap.editor).toBe(edB);
  });
});
