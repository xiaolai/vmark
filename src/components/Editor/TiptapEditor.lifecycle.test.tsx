// WI-RA14C.4 — the WYSIWYG editor's lifecycle, observed through what it does
// to the document and to the editor, not through which collaborator it called.
//
// The REAL component is mounted: production extensions, the markdown pipeline,
// the flush machinery, cursor sync, the pending-navigation consumer and the
// real stores. Only `@tauri-apps/*` is faked (the stateful in-memory disk the
// Tier-0 suites use, which the open path needs). Each case names a promise
// the editor makes to the reader:
//   - an edit reaches the document when Save flushes, and when the editor
//     unmounts with the edit still waiting for its frame or debounce;
//   - the reader's caret is remembered, and is put back on remount and when
//     a hidden editor is shown again;
//   - a hidden editor neither tracks the caret nor takes external content
//     until it is shown;
//   - a pending content-search jump wins over the caret restore, and a
//     preview pane neither consumes it nor takes focus.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});

import { WindowContext } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useFileLoadStore } from "@/stores/documentStore/fileLoad";
import { useTabStore } from "@/stores/tabStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { bootstrapFormats } from "@/lib/formats/registryBootstrap";
import {
  consumePendingContentSearchNav,
  setPendingContentSearchNav,
} from "@/services/navigation/contentSearchNavigation";
import { ROOT, WINDOW, doc, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { TiptapEditorInner } from "./TiptapEditor";

const DOC = `${ROOT}/notes.md`;
const ORIGINAL = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";

type Props = Parameters<typeof TiptapEditorInner>[0];

function inWindow(props: Props): ReactElement {
  return (
    <WindowContext.Provider value={{ windowLabel: WINDOW, isDocumentWindow: true }}>
      <TiptapEditorInner {...props} />
    </WindowContext.Provider>
  );
}

/** Let every pending frame, debounce and deferred parse run. */
async function settle(ms = 300): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount(props: Props = {}) {
  const view = render(inWindow(props));
  return { ...view, rerender: (next: Props) => view.rerender(inWindow(next)) };
}

/** The editor that registered itself as the window's live WYSIWYG editor. */
function liveEditor(): Editor {
  const editor = useEditorStore.getState().tiptap.editor;
  if (!editor) throw new Error("the WYSIWYG editor did not register itself");
  return editor;
}

/** The text the mounted editor is showing, read from its DOM. */
function shownText(container: HTMLElement): string {
  const pm = container.querySelector(".ProseMirror");
  if (!pm) throw new Error("no ProseMirror surface rendered");
  return pm.textContent ?? "";
}

/** Document position just inside the textblock that contains `text`. */
function posIn(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isTextblock && node.textContent.includes(text)) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`"${text}" not in the document`);
  return found;
}

/** The text of the textblock the caret is in. */
function caretBlock(editor: Editor): string {
  return editor.state.selection.$from.parent.textContent;
}

/** Place the caret the way a click does (a selection-only transaction). */
function clickInto(editor: Editor, text: string): void {
  act(() => {
    const pos = posIn(editor, text);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  });
}

/** Type at the end of the textblock that contains `text`. */
function typeAfter(editor: Editor, anchor: string, typed: string): void {
  act(() => {
    const start = posIn(editor, anchor);
    const end = start + editor.state.doc.resolve(start).parent.content.size;
    editor.commands.insertContentAt(end, typed);
  });
}

/**
 * jsdom has no layout and does not define these on Range at all; the editor's
 * scroll-into-view only needs them to exist.
 */
const LAYOUT_STUBS: Array<[object, string, () => unknown]> = [
  [Range.prototype, "getClientRects", () => []],
  [Range.prototype, "getBoundingClientRect", () => new DOMRect()],
];

let tabId: string;

// Production registers the format adapters at boot; the open path dispatches through them.
beforeAll(() => bootstrapFormats());

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  resetTier0();
  useEditorStore.getState().clearTiptap();
  for (const [target, name, value] of LAYOUT_STUBS) {
    if (name in target) throw new Error(`jsdom now defines ${name}; drop this stub`);
    Object.defineProperty(target, name, { configurable: true, value });
  }
  tabId = await openDocInTab(DOC, ORIGINAL);
});

afterEach(() => {
  cleanup();
  consumePendingContentSearchNav(tabId);
  for (const [target, name] of LAYOUT_STUBS) Reflect.deleteProperty(target, name);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("an edit reaches the document", () => {
  it("Save's flush writes the edit synchronously, before its frame fires", async () => {
    mount();
    await settle();
    typeAfter(liveEditor(), "Second paragraph.", " Typed.");
    expect(doc(tabId).content).toBe(ORIGINAL); // still waiting for its frame

    flushActiveWysiwygNow();

    expect(doc(tabId).content).toContain("Second paragraph. Typed.");
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("a small document's edit lands on the next frame without any flush", async () => {
    mount();
    await settle();
    typeAfter(liveEditor(), "Third paragraph.", " More.");

    await settle(50);

    expect(doc(tabId).content).toContain("Third paragraph. More.");
  });

  it("unmounting before the frame fires still writes the edit", async () => {
    const { unmount } = mount();
    await settle();
    typeAfter(liveEditor(), "First paragraph.", " Kept.");

    unmount();

    expect(doc(tabId).content).toContain("First paragraph. Kept.");
    // Nothing the dead editor scheduled may write afterwards.
    useDocumentStore.getState().setEditorContent(tabId, "replaced after unmount\n");
    await settle();
    expect(doc(tabId).content).toBe("replaced after unmount\n");
  });

  it("unmounting inside a large document's debounce window still writes the edit", async () => {
    const big = Array.from({ length: 400 }, (_, i) => `Paragraph number ${i} with some filler text in it.`).join("\n\n");
    tabId = await openDocInTab(`${ROOT}/big.md`, `${big}\n`);
    const { unmount } = mount();
    await settle();
    typeAfter(liveEditor(), "Paragraph number 7 ", " Edited.");
    await settle(250); // well inside the large-document debounce
    expect(doc(tabId).content).not.toContain("Edited.");

    unmount();

    expect(doc(tabId).content).toContain("Edited.");
    useDocumentStore.getState().setEditorContent(tabId, "replaced after unmount\n");
    await settle(2000);
    expect(doc(tabId).content).toBe("replaced after unmount\n");
  });

  it("a failed final flush is reported, not swallowed, and the unmount completes", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = mount();
    await settle();
    typeAfter(liveEditor(), "First paragraph.", " Lost?");
    const realWrite = useDocumentStore.getState().setEditorContent;
    useDocumentStore.setState({
      setEditorContent: () => {
        throw new Error("store write refused");
      },
    });

    try {
      expect(() => unmount()).not.toThrow();
    } finally {
      useDocumentStore.setState({ setEditorContent: realWrite });
    }

    expect(errors).toHaveBeenCalledWith(
      "[Tiptap]",
      expect.stringContaining("Unmount flush failed"),
      expect.objectContaining({ message: "store write refused" }),
    );
  });
});

describe("the reader's caret", () => {
  it("is recorded once tracking opens, and put back when the editor remounts", async () => {
    const first = mount();
    await settle();
    clickInto(liveEditor(), "Third paragraph.");
    await settle(50);
    const recorded = doc(tabId).cursorInfo;
    expect(recorded).not.toBeNull();
    first.unmount();

    mount();
    await settle();

    expect(caretBlock(liveEditor())).toBe("Third paragraph.");
    expect(doc(tabId).cursorInfo).toEqual(recorded);
  });

  it("is not recorded during the settling delay after creation", async () => {
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20); // past the deferred parse, before tracking opens
    });
    clickInto(liveEditor(), "Second paragraph.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(doc(tabId).cursorInfo).toBeNull();
  });

  it("with nothing recorded, a fresh open puts the caret at the start, focused", async () => {
    const { container } = mount();
    await settle();

    const editor = liveEditor();
    expect(editor.state.selection.from).toBe(1);
    expect(caretBlock(editor)).toBe("Title");
    expect(container.querySelector(".ProseMirror")?.contains(document.activeElement)).toBe(true);
    // The programmatic caret is ours, not the reader's — nothing is recorded.
    expect(doc(tabId).cursorInfo).toBeNull();
  });

  it("is restored when a hidden editor is shown again", async () => {
    const first = mount();
    await settle();
    clickInto(liveEditor(), "Second paragraph.");
    await settle(50);
    first.unmount();

    const { rerender } = mount({ hidden: true });
    await settle();
    rerender({ hidden: false });
    await settle();

    expect(caretBlock(liveEditor())).toBe("Second paragraph.");
  });

  it("a hidden editor does not record selection changes", async () => {
    const { container } = mount({ hidden: true });
    await settle();
    const editor = (container.querySelector(".ProseMirror") as HTMLElement & { editor?: Editor }).editor;
    if (!editor) throw new Error("the hidden editor's view carries no editor");

    clickInto(editor, "Third paragraph.");
    await settle(50);

    expect(doc(tabId).cursorInfo).toBeNull();
    expect(doc(tabId).selectedText).toBe("");
  });
});

describe("external content and visibility", () => {
  it("a hidden editor ignores external content until it is shown, then takes the latest", async () => {
    const { container, rerender } = mount({ hidden: true });
    await settle();
    expect(shownText(container)).toContain("First paragraph.");

    act(() => {
      useDocumentStore.getState().setEditorContent(tabId, "# Title\n\nWritten while hidden.\n");
    });
    await settle();
    expect(shownText(container)).not.toContain("Written while hidden.");

    rerender({ hidden: false });
    await settle();

    expect(shownText(container)).toContain("Written while hidden.");
    expect(shownText(container)).not.toContain("First paragraph.");
  });

  it("a visible editor takes external content as it arrives", async () => {
    const { container } = mount();
    await settle();

    act(() => {
      useDocumentStore.getState().setEditorContent(tabId, "# Title\n\nArrived from outside.\n");
    });
    await settle();

    expect(shownText(container)).toContain("Arrived from outside.");
    // Taking it is not an edit: the editor must not write it back as one.
    expect(doc(tabId).content).toBe("# Title\n\nArrived from outside.\n");
  });
});

describe("a pending content-search jump", () => {
  it("is consumed by the deferred initialization and wins over the caret restore", async () => {
    setPendingContentSearchNav(tabId, 3, "");
    mount();
    await settle();

    // Third textblock: "Second paragraph." (Title, First, Second).
    expect(caretBlock(liveEditor())).toBe("Second paragraph.");
    expect(consumePendingContentSearchNav(tabId)).toBeUndefined();
  });

  it("is left for the editable pane when a preview becomes visible, and the preview takes no focus", async () => {
    const { container, rerender } = mount({ hidden: true, preview: true });
    await settle();
    setPendingContentSearchNav(tabId, 2, "");

    rerender({ hidden: false, preview: true });
    await settle();

    expect(consumePendingContentSearchNav(tabId)).toEqual({ line: 2, query: "" });
    expect(container.querySelector(".ProseMirror")?.contains(document.activeElement)).toBe(false);
    // A preview never registers as the window's editor.
    expect(useEditorStore.getState().tiptap.editor).toBeNull();
    expect(shownText(container)).toContain("First paragraph.");
  });
});

describe("the large-file loading indicator", () => {
  afterEach(() => useFileLoadStore.getState().endLoad());

  it("is cleared when the editor unmounts before its deferred parse runs", async () => {
    useFileLoadStore.getState().startLoad("notes.md", 5_000_000);
    const { unmount } = mount();
    unmount();
    await settle();

    expect(useFileLoadStore.getState().active).toBe(false);
  });

  it("is left alone when a newer load superseded the one the editor mounted under", async () => {
    const mounted = useFileLoadStore.getState().startLoad("notes.md", 5_000_000);
    const { container, unmount } = mount();
    // Run timers one at a time until the editor is created (it captures the
    // load id then) and its deferred parse is queued, but has not run.
    const created = () => (container.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null)?.editor?.isInitialized === true;
    while (!created() && vi.getTimerCount() > 0) act(() => void vi.advanceTimersToNextTimer());
    expect(created()).toBe(true);
    const newer = useFileLoadStore.getState().startLoad("other.md", 6_000_000);
    expect(newer).toBeGreaterThan(mounted);
    unmount();
    await settle();

    expect(useFileLoadStore.getState()).toMatchObject({ active: true, loadId: newer, filename: "other.md" });
  });
});

describe("with no tab to write to", () => {
  it("an edit is written to no document", async () => {
    useTabStore.setState({ activeTabId: {} });
    const { container } = mount();
    await settle();
    const editor = (container.querySelector(".ProseMirror") as HTMLElement & { editor?: Editor }).editor;
    if (!editor) throw new Error("the editor's view carries no editor");

    typeAfter(editor, "", "Orphan text");
    await settle();
    flushActiveWysiwygNow();

    expect(doc(tabId).content).toBe(ORIGINAL);
  });
});
