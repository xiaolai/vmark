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

  it("handles fresh document load (null cursor info) with scroll preservation", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const mockDoc = { content: { size: 10 } };
    const view = {
      dom: { isConnected: true, parentElement: null },
      focus,
      dispatch,
      state: {
        doc: mockDoc,
        tr: {
          setSelection: vi.fn().mockReturnThis(),
        },
      },
    } as unknown as EditorView;

    const editor = {
      isDestroyed: false,
      view,
    } as TiptapEditor;

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

    expect(focus).toHaveBeenCalledTimes(1);
    expect(restoreCursor).not.toHaveBeenCalled();
  });

  it("retries when view is not connected", () => {
    let callCount = 0;
    const focus = vi.fn();

    // View starts disconnected, becomes connected on 2nd attempt
    const view = {
      dom: {
        get isConnected() {
          // First call (callCount=1): false, second call (callCount=2): true
          return callCount >= 2;
        },
        parentElement: null,
      },
      focus,
      dispatch: vi.fn(),
      state: {
        doc: { content: { size: 10 } },
        tr: { setSelection: vi.fn().mockReturnThis() },
      },
    } as unknown as EditorView;

    const editor = {
      isDestroyed: false,
      view,
    } as TiptapEditor;

    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    const raf = vi.fn((cb: FrameRequestCallback) => {
      callCount++;
      cb(0);
      return callCount;
    });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;

    // Should have retried 2 times (1 fail + 1 success)
    expect(raf).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("stops retrying after max attempts", () => {
    const focus = vi.fn();
    const view = {
      dom: { isConnected: false },
      focus,
    } as unknown as EditorView;

    const editor = {
      isDestroyed: false,
      view,
    } as TiptapEditor;

    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    let callCount = 0;
    const raf = vi.fn((cb: FrameRequestCallback) => {
      callCount++;
      cb(0);
      return callCount;
    });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;

    // Should stop at MAX_FOCUS_ATTEMPTS (12)
    expect(raf).toHaveBeenCalledTimes(12);
    expect(focus).not.toHaveBeenCalled();
  });

  it("handles focus throwing an error gracefully", () => {
    const focus = vi.fn(() => {
      throw new Error("Focus failed");
    });
    const view = {
      dom: { isConnected: true, parentElement: null },
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

    // Should not throw
    expect(() => {
      scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);
    }).not.toThrow();

    globalThis.requestAnimationFrame = originalRaf;

    expect(focus).toHaveBeenCalledTimes(1);
    // restoreCursor should not be called when focus fails
    expect(restoreCursor).not.toHaveBeenCalled();
  });

  it("handles focus error in fresh document load path", () => {
    const focus = vi.fn(() => {
      throw new Error("Focus failed");
    });
    const dispatch = vi.fn();
    const view = {
      dom: { isConnected: true, parentElement: null },
      focus,
      dispatch,
      state: {
        doc: { content: { size: 10 } },
        tr: { setSelection: vi.fn().mockReturnThis() },
      },
    } as unknown as EditorView;

    const editor = {
      isDestroyed: false,
      view,
    } as TiptapEditor;

    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    expect(() => {
      scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);
    }).not.toThrow();

    globalThis.requestAnimationFrame = originalRaf;

    expect(focus).toHaveBeenCalledTimes(1);
    // dispatch should not be called when focus fails
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("scrolls to top on fresh document load", () => {
    // For fresh document loads, we always scroll to 0 to ensure a consistent
    // initial view. This handles cases where content is loaded asynchronously
    // (e.g., via useFinderFileOpen for cold start), which could cause the
    // browser to auto-scroll before this RAF runs.
    const focus = vi.fn();
    const dispatch = vi.fn();
    let scrollTop = 100; // Simulated scroll position (might be non-zero if content loaded before RAF)
    const scrollContainer = {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(val: number) {
        scrollTop = val;
      },
      style: { overflowY: "auto" },
    };
    const view = {
      dom: {
        isConnected: true,
        parentElement: scrollContainer,
        style: { overflowY: "visible" },
      },
      focus,
      dispatch,
      state: {
        doc: { content: { size: 10 } },
        tr: { setSelection: vi.fn().mockReturnThis() },
      },
    } as unknown as EditorView;

    const editor = {
      isDestroyed: false,
      view,
    } as TiptapEditor;

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

    // Fresh document loads should always start at top
    expect(scrollTop).toBe(0);
  });

  it("scrolls to top when scroll container uses overflow: scroll (not auto)", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    let scrollTop = 200;
    const scrollContainer = {
      get scrollTop() { return scrollTop; },
      set scrollTop(val: number) { scrollTop = val; },
      style: { overflowY: "scroll" },
      parentElement: null,
    };
    const view = {
      dom: {
        isConnected: true,
        parentElement: scrollContainer,
        style: { overflowY: "visible" },
      },
      focus,
      dispatch,
      state: {
        doc: { content: { size: 10 } },
        tr: { setSelection: vi.fn().mockReturnThis() },
      },
    } as unknown as EditorView;

    const editor = { isDestroyed: false, view } as TiptapEditor;
    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    const raf = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;

    expect(scrollTop).toBe(0);
  });

  it("falls back to parentElement when getComputedStyle throws (line 38-40)", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    let scrollTop = 150;
    const parentEl = {
      get scrollTop() { return scrollTop; },
      set scrollTop(val: number) { scrollTop = val; },
    };
    const view = {
      dom: {
        isConnected: true,
        parentElement: parentEl,
        // getComputedStyle will throw because this element lacks style info
      },
      focus,
      dispatch,
      state: {
        doc: { content: { size: 10 } },
        tr: { setSelection: vi.fn().mockReturnThis() },
      },
    } as unknown as EditorView;

    const editor = { isDestroyed: false, view } as TiptapEditor;
    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    // Mock getComputedStyle to throw
    const origGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = vi.fn(() => { throw new Error("mock error"); });

    const raf = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.getComputedStyle = origGetComputedStyle;

    // getComputedStyle threw, so getScrollContainer breaks out and returns parentElement
    // parentElement is set, so scrollTop should be set to 0
    expect(scrollTop).toBe(0);
  });

  it("walks ancestors without overflow and falls back to parentElement (line 42)", () => {
    // This test exercises line 42: `el = el.parentElement` — the loop advances
    // when getComputedStyle succeeds but overflowY is neither "auto" nor "scroll".
    // We mock getComputedStyle to return "visible" for all elements so the loop
    // walks the full ancestor chain before returning parentElement.
    const focus = vi.fn();
    const dispatch = vi.fn();
    let scrollTop = 200;
    const grandparent = {
      get scrollTop() { return scrollTop; },
      set scrollTop(val: number) { scrollTop = val; },
      parentElement: null,
    };
    const parent = {
      parentElement: grandparent,
    };
    const domEl = {
      isConnected: true,
      parentElement: parent,
    };
    const view = {
      dom: domEl,
      focus,
      dispatch,
      state: {
        doc: { content: { size: 10 } },
        tr: { setSelection: vi.fn().mockReturnThis() },
      },
    } as unknown as EditorView;

    const editor = { isDestroyed: false, view } as TiptapEditor;
    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    // Mock getComputedStyle to return overflowY="visible" for all elements
    // so the while loop advances via `el = el.parentElement` (line 42) each time
    // without finding a scroll container, then exits when el becomes null.
    const origGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = vi.fn(() => ({ overflowY: "visible" } as CSSStyleDeclaration));

    const raf = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.getComputedStyle = origGetComputedStyle;

    // Loop walked all ancestors via line 42, returned view.dom.parentElement.
    // Focus should have been called (fresh load path).
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("returns the editor DOM element itself as scroll container when it has overflowY=auto (line 35)", () => {
    // Covers the `return el` branch in getScrollContainer when getComputedStyle
    // returns overflowY === "auto" for view.dom itself (the very first while iteration).
    const focus = vi.fn();
    const dispatch = vi.fn();
    let scrollTop = 500;
    const editorDom = {
      isConnected: true,
      get scrollTop() { return scrollTop; },
      set scrollTop(val: number) { scrollTop = val; },
      parentElement: null,
    };
    const view = {
      dom: editorDom,
      focus,
      dispatch,
      state: {
        doc: { content: { size: 10 } },
        tr: { setSelection: vi.fn().mockReturnThis() },
      },
    } as unknown as EditorView;

    const editor = { isDestroyed: false, view } as TiptapEditor;
    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null); // fresh load path

    // Mock getComputedStyle so it reports overflowY=auto for editorDom specifically
    const origGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = vi.fn((el: Element) => {
      if (el === editorDom) return { overflowY: "auto" } as CSSStyleDeclaration;
      return origGetComputedStyle(el);
    });

    const raf = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);

    globalThis.requestAnimationFrame = originalRaf;
    globalThis.getComputedStyle = origGetComputedStyle;

    // view.dom itself was identified as scroll container and scrollTop was set to 0
    expect(scrollTop).toBe(0);
  });

  it("handles setSelection throwing an error gracefully", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = {
      dom: { isConnected: true, parentElement: null },
      focus,
      dispatch,
      state: {
        doc: { content: { size: 10 } },
        tr: {
          setSelection: vi.fn(() => {
            throw new Error("Selection failed");
          }),
        },
      },
    } as unknown as EditorView;

    const editor = {
      isDestroyed: false,
      view,
    } as TiptapEditor;

    const restoreCursor = vi.fn();
    const getCursorInfo = vi.fn().mockReturnValue(null);

    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;

    // Should not throw
    expect(() => {
      scheduleTiptapFocusAndRestore(editor, getCursorInfo, restoreCursor);
    }).not.toThrow();

    globalThis.requestAnimationFrame = originalRaf;

    expect(focus).toHaveBeenCalledTimes(1);
  });
});
