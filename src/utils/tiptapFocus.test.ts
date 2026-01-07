import { describe, expect, it, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { scheduleTiptapFocusAndRestore } from "./tiptapFocus";

describe("scheduleTiptapFocusAndRestore", () => {
  it("focuses and restores once the view is connected", () => {
    const focus = vi.fn();
    const view = {
      dom: { isConnected: true },
      focus,
    } as unknown as EditorView;

    const editor = {
      isDestroyed: false,
      view,
    } as TiptapEditor;

    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue({
      contentLineIndex: 0,
      wordAtCursor: "",
      offsetInWord: 0,
      nodeType: "paragraph",
      percentInLine: 0,
      contextBefore: "",
      contextAfter: "",
    });

    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;

    expect(focus).toHaveBeenCalledTimes(1);
    expect(restoreCursor).toHaveBeenCalledTimes(1);
  });

  it("bails out when the editor is destroyed", () => {
    const editor = {
      isDestroyed: true,
      view: undefined,
    } as unknown as TiptapEditor;

    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;

    expect(restoreCursor).not.toHaveBeenCalled();
  });
});
