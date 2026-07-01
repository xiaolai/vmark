import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef, type ReactNode, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";

// Avoid real CodeMirror state math — the hook only needs a context object.
vi.mock("@/plugins/sourceContextDetection/cursorContext", () => ({
  computeSourceCursorContext: () => ({ marks: {}, block: null }),
}));

import { useSourcePaneFocus } from "./useSourcePaneFocus";
import { usePaneStore } from "@/stores/paneStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { PaneProvider } from "@/contexts/PaneContext";
import type { PaneId } from "@/stores/paneStore";

const W = "main";

function fakeView(id: string): EditorView {
  return { id } as unknown as EditorView;
}

function paneWrapper(paneId: PaneId) {
  return ({ children }: { children: ReactNode }) => (
    <PaneProvider value={{ paneId, tabId: `${paneId}-tab` }}>{children}</PaneProvider>
  );
}

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useEditorStore.getState().clearActiveEditors();
  useTabStore.setState({ activeTabId: { [W]: "tab-1" } } as never);
});

function renderWithView(
  view: EditorView | null,
  hidden: boolean,
  wrapper?: ReturnType<typeof paneWrapper>,
) {
  return renderHook(
    () => {
      const ref = useRef<EditorView | null>(view) as MutableRefObject<EditorView | null>;
      return useSourcePaneFocus(ref, W, hidden);
    },
    wrapper ? { wrapper } : undefined,
  );
}

describe("useSourcePaneFocus (#1081 — ADR-3)", () => {
  it("registers the source view when visible and focused (single pane)", () => {
    const view = fakeView("A");
    const { result } = renderWithView(view, false);
    expect(result.current.current).toBe(true);
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);
    expect(useEditorStore.getState().active.activeSourceTabId).toBe("tab-1");
  });

  it("does not register when hidden", () => {
    const view = fakeView("A");
    renderWithView(view, true);
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("does not register when the view ref is empty", () => {
    renderWithView(null, false);
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("an unfocused split pane does not register (ref reflects unfocused)", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const view = fakeView("primary");
    const { result } = renderWithView(view, false, paneWrapper("primary"));
    expect(result.current.current).toBe(false);
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("the focused split pane registers its source view", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const view = fakeView("secondary");
    const { result } = renderWithView(view, false, paneWrapper("secondary"));
    expect(result.current.current).toBe(true);
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);
  });
});
