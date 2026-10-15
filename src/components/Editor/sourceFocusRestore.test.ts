// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CursorInfo } from "@/types/cursorSync";

const mockRestoreCursor = vi.fn();

vi.mock("@/utils/cursorSync/codemirror", () => ({
  restoreCursorInCodeMirror: (...args: unknown[]) => mockRestoreCursor(...args),
}));

import {
  clearEditorScrollOffsets,
  setEditorScrollOffset,
} from "@/services/editor/scrollPosition";
import {
  clearPendingContentSearchNav,
  setPendingContentSearchNav,
} from "@/services/navigation/contentSearchNavigation";
import { clearPendingLintScroll } from "@/services/lint/lintNavigation";
import { chooseEditorRestore, forgetShownEditorSurface } from "@/services/editor/restoreChoice";
import { focusAndRestoreSource } from "./sourceFocusRestore";

function makeView() {
  let scrollTop = 0;
  const focus = vi.fn();
  const dispatch = vi.fn();
  const view = {
    focus,
    dispatch,
    // A real document, so a consumed jump can resolve its target line.
    state: EditorState.create({ doc: "one\ntwo\nthree" }),
    scrollDOM: {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = value;
      },
    },
  };
  return { view: view as unknown as EditorView, focus, dispatch, read: () => scrollTop };
}

const cursor = { contentLineIndex: 4 } as unknown as CursorInfo;

beforeEach(() => {
  vi.clearAllMocks();
  clearEditorScrollOffsets("tab-1");
  forgetShownEditorSurface("tab-1");
  clearPendingContentSearchNav("tab-1");
  clearPendingLintScroll("tab-1");
  // A synchronous frame scheduler keeps the bounded restore loop in this tick.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
});

describe("focusAndRestoreSource", () => {
  it("restores the cursor on a first show, leaving the scroll to it", () => {
    setEditorScrollOffset("tab-1", "source", 400);
    const { view, focus, read } = makeView();

    focusAndRestoreSource(view, "tab-1", cursor);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(mockRestoreCursor).toHaveBeenCalledWith(view, cursor, true);
    expect(read()).toBe(0);
  });

  it("returns a reader to where they scrolled, not to the caret, after a tab switch (#1556)", () => {
    // The reported bug: the caret placed once won every later restore, so each
    // document snapped back to the same fixed place however far it was read.
    focusAndRestoreSource(makeView().view, "tab-1", cursor);
    setEditorScrollOffset("tab-1", "source", 4200);
    mockRestoreCursor.mockClear();
    const { view, read } = makeView();

    focusAndRestoreSource(view, "tab-1", cursor);

    // The caret is put back where it was, without scrolling to it.
    expect(mockRestoreCursor).toHaveBeenCalledWith(view, cursor, false);
    expect(read()).toBe(4200);
  });

  it("follows the reader across repeated round trips (#1556)", () => {
    focusAndRestoreSource(makeView().view, "tab-1", cursor);
    for (const offset of [1200, 3600, 800]) {
      setEditorScrollOffset("tab-1", "source", offset);
      const { view, read } = makeView();
      focusAndRestoreSource(view, "tab-1", cursor);
      expect(read()).toBe(offset);
    }
  });

  it("hands a mode switch to the cursor, which carries the position mapping", () => {
    setEditorScrollOffset("tab-1", "source", 400);
    chooseEditorRestore("tab-1", "wysiwyg", true); // the tab was last on the WYSIWYG surface
    const { view, read } = makeView();

    focusAndRestoreSource(view, "tab-1", cursor);

    expect(mockRestoreCursor).toHaveBeenCalledWith(view, cursor, true);
    expect(read()).toBe(0);
  });

  it("restores the remembered reading position when there is no cursor (#1249)", () => {
    setEditorScrollOffset("tab-1", "source", 400);
    const { view, focus, read } = makeView();

    focusAndRestoreSource(view, "tab-1", null);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(mockRestoreCursor).not.toHaveBeenCalled();
    expect(read()).toBe(400);
  });

  it("starts at the top when the tab has no remembered position", () => {
    const { view, read } = makeView();
    view.scrollDOM.scrollTop = 250;

    focusAndRestoreSource(view, "tab-1", null);

    expect(read()).toBe(0);
  });

  it("stands aside entirely when a lint/search jump owns the viewport", () => {
    // The restore watches the container for ~1.5s while late content settles,
    // so running it alongside a jump would drag the reader off the line they
    // asked for. A consumed navigation short-circuits both restores.
    setEditorScrollOffset("tab-1", "source", 400);
    const { view, focus, dispatch, read } = makeView();
    // A Find-in-Files / file-link jump to line 2, with no query to pre-fill.
    setPendingContentSearchNav("tab-1", 2, "");

    focusAndRestoreSource(view, "tab-1", cursor);

    expect(focus).toHaveBeenCalledTimes(1);
    // The jump ran: the selection lands at the start of line 2 ("two").
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ selection: { anchor: 4 } });
    expect(mockRestoreCursor).not.toHaveBeenCalled();
    expect(read()).toBe(0);
  });

  it("consumes the jump once — the next restore is an ordinary one", () => {
    setPendingContentSearchNav("tab-1", 2, "");
    const first = makeView();
    focusAndRestoreSource(first.view, "tab-1", null);
    expect(first.dispatch).toHaveBeenCalledTimes(1);

    const second = makeView();
    focusAndRestoreSource(second.view, "tab-1", cursor);
    expect(second.dispatch).not.toHaveBeenCalled();
    expect(mockRestoreCursor).toHaveBeenCalledWith(second.view, cursor, true);
  });
});
