// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { CursorInfo } from "@/types/cursorSync";

const mockRestoreCursor = vi.fn();
const mockConsumePendingNav = vi.fn();

vi.mock("@/utils/cursorSync/codemirror", () => ({
  restoreCursorInCodeMirror: (...args: unknown[]) => mockRestoreCursor(...args),
}));
vi.mock("./sourcePendingNav", () => ({
  consumeSourcePendingNav: (...args: unknown[]) => mockConsumePendingNav(...args),
}));

import {
  clearEditorScrollOffsets,
  setEditorScrollOffset,
} from "@/services/editor/scrollPosition";
import { focusAndRestoreSource } from "./sourceFocusRestore";

function makeView() {
  let scrollTop = 0;
  const focus = vi.fn();
  const view = {
    focus,
    scrollDOM: {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = value;
      },
    },
  };
  return { view: view as unknown as EditorView, focus, read: () => scrollTop };
}

const cursor = { contentLineIndex: 4 } as unknown as CursorInfo;

beforeEach(() => {
  vi.clearAllMocks();
  clearEditorScrollOffsets("tab-1");
  // A synchronous frame scheduler keeps the bounded restore loop in this tick.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
});

describe("focusAndRestoreSource", () => {
  it("restores the cursor when one exists, leaving the scroll to it", () => {
    setEditorScrollOffset("tab-1", "source", 400);
    const { view, focus, read } = makeView();

    focusAndRestoreSource(view, "tab-1", cursor);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(mockRestoreCursor).toHaveBeenCalledWith(view, cursor);
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
    const { view, focus, read } = makeView();
    mockConsumePendingNav.mockReturnValue(true);

    focusAndRestoreSource(view, "tab-1", cursor);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(mockConsumePendingNav).toHaveBeenCalledWith(view, "tab-1");
    expect(mockRestoreCursor).not.toHaveBeenCalled();
    expect(read()).toBe(0);
  });
});
