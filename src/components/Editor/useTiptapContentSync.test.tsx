// WI-RA10B.4 — the markdown split's preview pane re-parses a large document
// once typing has settled, not on every keystroke; an editable pane and a
// small document still sync at once.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

import { useTiptapContentSync } from "./useTiptapContentSync";

/**
 * A real editor; every document it receives from the hook's re-parse is
 * recorded, so the tests observe the sync itself rather than a call to it.
 */
let editor: TiptapEditor;
let synced: string[] = [];

const ref = <T,>(current: T) => ({ current });
const doc = (chars: number, tail: string) => "x".repeat(chars - tail.length) + tail;

function mount(content: string, { preview }: { preview: boolean }) {
  const refs = {
    hiddenRef: ref(false),
    previewRef: ref(preview),
    isInternalChange: ref(false),
    lastExternalContent: ref(content),
    editorInitialized: ref(true),
    preserveLineBreaksRef: ref(false),
    cursorInfoRef: ref(null),
    isFocusedPaneRef: ref(true),
  };
  const hook = renderHook(
    (next: string) =>
      useTiptapContentSync({ editor, content: next, hidden: false, activeTabId: "tab-1", ...refs }),
    { initialProps: content },
  );
  // The mount's visibility effect may sync once; only what follows is under test.
  synced = [];
  return { ...hook, refs };
}

const syncedContents = () => synced;

beforeEach(() => {
  vi.useFakeTimers();
  editor = new TiptapEditor({ extensions: [StarterKit] });
  editor.on("transaction", ({ transaction }) => {
    if (transaction.docChanged) synced.push(editor.state.doc.textContent);
  });
  synced = [];
});

afterEach(() => {
  editor.destroy();
  vi.useRealTimers();
});

describe("useTiptapContentSync — preview pane", () => {
  it("re-parses a large document once, after typing pauses for its tier", () => {
    const { rerender } = mount(doc(30_000, "1"), { preview: true });

    for (const tail of ["2", "3", "4"]) {
      rerender(doc(30_000, tail));
      vi.advanceTimersByTime(100);
    }
    expect(syncedContents()).toEqual([]);

    vi.advanceTimersByTime(199); // 100 ms of the 300 already passed in the loop
    expect(syncedContents()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(syncedContents()).toEqual([doc(30_000, "4")]);
  });

  it("re-parses a small document on every change, at once", () => {
    const { rerender } = mount("one", { preview: true });
    rerender("two");
    rerender("three");
    expect(syncedContents()).toEqual(["two", "three"]);
  });

  it("drops a pending re-parse when the pane unmounts", () => {
    const { rerender, unmount } = mount(doc(30_000, "1"), { preview: true });
    rerender(doc(30_000, "2"));
    unmount();
    vi.advanceTimersByTime(5_000);
    expect(syncedContents()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips a re-parse whose pane was hidden while it waited", () => {
    const { rerender, refs } = mount(doc(30_000, "1"), { preview: true });
    rerender(doc(30_000, "2"));
    refs.hiddenRef.current = true;
    vi.advanceTimersByTime(300);
    expect(syncedContents()).toEqual([]);
  });
});

describe("useTiptapContentSync — editable pane", () => {
  it("applies an external change to a large document at once", () => {
    const { rerender } = mount(doc(30_000, "1"), { preview: false });
    rerender(doc(30_000, "2"));
    expect(syncedContents()).toEqual([doc(30_000, "2")]);
  });

  it("ignores a change that is the editor's own content coming back", () => {
    const { rerender, refs } = mount("one", { preview: false });
    refs.lastExternalContent.current = "two";
    rerender("two");
    expect(syncedContents()).toEqual([]);
  });
});
