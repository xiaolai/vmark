// #1634 — an immediate initial load runs while React commits the editor, and
// Tiptap may still tear that editor down: useEditor arms a 1 ms destroy timer
// at construction and only disarms it in its passive mount effect, so a long
// non-discrete commit can let the timer win and a fresh editor replaces it.
// The load therefore has two phases. The document goes in at once (first
// painted frame); the setup with effects outside the editor — a pending
// content-search jump, the toolbar context — waits for `finish`, which the
// component calls from its own passive effect and which a torn-down editor
// skips, so the replacement editor still finds the jump.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

import {
  consumePendingContentSearchNav,
  setPendingContentSearchNav,
} from "@/services/navigation/contentSearchNavigation";
import { useFileLoadStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { startInitialLoad, type InitialLoadRefs } from "./tiptapInitialLoad";

const TAB = "tab-initial-load";
const ref = <T,>(current: T) => ({ current });

function refsFor(content: string): InitialLoadRefs {
  return {
    lastExternalContent: ref(""),
    editorInitialized: ref(false),
    contentRef: ref(content),
    hiddenRef: ref(false),
    previewRef: ref(false),
    preserveLineBreaksRef: ref(false),
    cursorInfoRef: ref(null),
    isFocusedPaneRef: ref(true),
  };
}

let editor: TiptapEditor;

beforeEach(() => {
  editor = new TiptapEditor({ extensions: [StarterKit] });
  useEditorStore.getState().clearTiptap();
});

afterEach(() => {
  if (!editor.isDestroyed) editor.destroy();
  consumePendingContentSearchNav(TAB);
  useFileLoadStore.getState().endLoad();
  vi.useRealTimers();
});

describe("startInitialLoad — an immediate load", () => {
  it("puts the document in at once and leaves the outside setup to finish", () => {
    setPendingContentSearchNav(TAB, 2, "");
    const refs = refsFor("# Title\n\nBody one\n\nBody two\n");

    const finish = startInitialLoad(editor, TAB, refs);

    expect(editor.state.doc.textContent).toBe("TitleBody oneBody two");
    expect(refs.editorInitialized.current).toBe(true);
    expect(useEditorStore.getState().tiptap.context, "no outside setup yet").toBeNull();
    expect(finish).toBeTypeOf("function");

    finish?.();

    expect(consumePendingContentSearchNav(TAB), "the jump was taken").toBeUndefined();
    expect(useEditorStore.getState().tiptap.context).not.toBeNull();
  });

  it("finishes nothing for an editor torn down before its passive effect", () => {
    setPendingContentSearchNav(TAB, 2, "");
    const finish = startInitialLoad(editor, TAB, refsFor("# Title\n\nBody\n"));

    editor.destroy();
    finish?.();

    expect(consumePendingContentSearchNav(TAB), "left for the replacement editor").toEqual({ line: 2, query: "" });
    expect(useEditorStore.getState().tiptap.context).toBeNull();
  });
});

describe("startInitialLoad — a deferred load", () => {
  it("returns nothing to finish and does the whole load in its task", () => {
    vi.useFakeTimers();
    setPendingContentSearchNav(TAB, 1, "");
    const refs = refsFor("# Title\n\nBody\n");
    // The loading indicator is what defers this small document.
    useFileLoadStore.getState().startLoad("big.md", 1);

    const finish = startInitialLoad(editor, TAB, refs);

    expect(finish).toBeNull();
    expect(editor.state.doc.textContent).toBe("");
    vi.runOnlyPendingTimers();
    expect(editor.state.doc.textContent).toBe("TitleBody");
    expect(consumePendingContentSearchNav(TAB)).toBeUndefined();
    expect(useFileLoadStore.getState().active, "the load ended the indicator").toBe(false);
  });
});
