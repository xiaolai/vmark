// @vitest-environment node
/**
 * WYSIWYG tab-switch restore (#1556): once a caret exists, a return to the
 * same surface must still land where the reader scrolled, not at the caret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { Schema } from "@tiptap/pm/model";
import type { CursorInfo } from "@/stores/documentStore";
import { scheduleTiptapFocusAndRestore } from "./tiptapFocus";
import { chooseEditorRestore, forgetShownEditorSurface } from "./restoreChoice";
import { clearEditorScrollOffsets, setEditorScrollOffset } from "./scrollPosition";

const TAB = "tab-switch";
const cursor = { sourceLine: 3, wordAtCursor: "中文" } as unknown as CursorInfo;

// A REAL doc: `Selection.atStart` rejects a stand-in, and the caret-reset
// branch swallows that — which would make "reset / not reset" unobservable.
const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} },
});
const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("阅读位置")])]);

/** A mounted WYSIWYG view whose scroll container can hold any offset. */
function mount() {
  let scrollTop = 0;
  const scrollContainer = {
    get scrollTop() { return scrollTop; },
    set scrollTop(val: number) { scrollTop = val; },
    scrollHeight: 20_000,
    clientHeight: 500,
    style: { overflowY: "auto" },
    parentElement: null,
    ownerDocument: null,
  };
  const setSelection = vi.fn().mockReturnThis();
  const view = {
    dom: { isConnected: true, parentElement: scrollContainer, children: [] },
    focus: vi.fn(),
    dispatch: vi.fn(),
    state: {
      doc,
      tr: { setSelection, setMeta: vi.fn().mockReturnThis() },
    },
  } as unknown as EditorView;
  const restoreCursor = vi.fn();
  const restore = (info: CursorInfo | null) =>
    scheduleTiptapFocusAndRestore(
      { isDestroyed: false, view } as TiptapEditor,
      () => info,
      restoreCursor,
      TAB,
    );
  return { view, setSelection, restoreCursor, restore, read: () => scrollTop };
}

const originalRaf = globalThis.requestAnimationFrame;

beforeEach(() => {
  clearEditorScrollOffsets(TAB);
  forgetShownEditorSurface(TAB);
  // A synchronous frame scheduler keeps the bounded restore loop in this tick.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf;
  clearEditorScrollOffsets(TAB);
  forgetShownEditorSurface(TAB);
});

describe("scheduleTiptapFocusAndRestore across tab switches (#1556)", () => {
  it("returns the reader to where they scrolled, with the caret put back unscrolled", () => {
    mount().restore(cursor); // first show: the caret owns the viewport
    setEditorScrollOffset(TAB, "wysiwyg", 6000); // then the reader scrolled on

    const back = mount();
    back.restore(cursor);

    expect(back.restoreCursor).toHaveBeenCalledWith(back.view, cursor, false);
    expect(back.read()).toBe(6000);
    // The caret was restored, not reset to the start of the document.
    expect(back.setSelection).not.toHaveBeenCalled();
  });

  it("follows the reader across repeated round trips", () => {
    mount().restore(cursor);
    for (const offset of [1500, 9000, 400]) {
      setEditorScrollOffset(TAB, "wysiwyg", offset);
      const back = mount();
      back.restore(cursor);
      expect(back.read()).toBe(offset);
    }
  });

  it("lands at the top when the reader scrolled back to it", () => {
    mount().restore(cursor);
    setEditorScrollOffset(TAB, "wysiwyg", 0);

    const back = mount();
    back.restore(cursor);

    expect(back.restoreCursor).toHaveBeenCalledWith(back.view, cursor, false);
    expect(back.read()).toBe(0);
  });

  it("restores by cursor, with its scroll, on the first show", () => {
    setEditorScrollOffset(TAB, "wysiwyg", 6000);
    const first = mount();

    first.restore(cursor);

    expect(first.restoreCursor).toHaveBeenCalledWith(first.view, cursor, true);
    expect(first.read()).toBe(0);
  });

  it("restores by cursor on a switch from Source mode", () => {
    setEditorScrollOffset(TAB, "wysiwyg", 6000);
    chooseEditorRestore(TAB, "source", true); // the tab was last shown in Source
    const view = mount();

    view.restore(cursor);

    expect(view.restoreCursor).toHaveBeenCalledWith(view.view, cursor, true);
    expect(view.read()).toBe(0);
  });

  it("keeps the no-cursor path: reading position restored, caret reset to the start (#1249)", () => {
    mount().restore(null);
    setEditorScrollOffset(TAB, "wysiwyg", 2500);

    const back = mount();
    back.restore(null);

    expect(back.restoreCursor).not.toHaveBeenCalled();
    expect(back.setSelection).toHaveBeenCalledTimes(1);
    expect(back.read()).toBe(2500);
  });
});
