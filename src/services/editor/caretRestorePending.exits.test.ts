// @vitest-environment node
// WI-AL2.2g — no exit of a mount or show caret restore leaves its editor pending: the WYSIWYG restore settles when it runs, gives up after its last frame, finds the editor destroyed, or throws; the Source restore settles when it runs, throws, or is cancelled on unmount.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { EditorView as CMView } from "@codemirror/view";
import type { CursorInfo } from "@/types/cursorSync";
import { isCaretRestorePending } from "./caretRestorePending";
import { scheduleTiptapFocusAndRestore } from "./tiptapFocus";
import { scheduleSourceFocusRestore } from "@/components/Editor/sourceFocusRestore";

const CURSOR: CursorInfo = {
  sourceLine: 1,
  wordAtCursor: "",
  offsetInWord: 0,
  nodeType: "paragraph",
  percentInLine: 0,
  contextBefore: "",
  contextAfter: "",
};

let frames: FrameRequestCallback[] = [];

function runFrame(): void {
  const due = frames;
  frames = [];
  for (const cb of due) cb(0);
}

/** A Tiptap editor double whose view is connected per `connected`. */
function fakeEditor(connected: { value: boolean }, focus: () => void = () => {}): TiptapEditor {
  const view = {
    get dom() {
      return { isConnected: connected.value };
    },
    focus,
  } as unknown as EditorView;
  return { isDestroyed: false, view } as unknown as TiptapEditor;
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WYSIWYG restore — every exit settles", () => {
  it("is pending from schedule until the restore runs", () => {
    const editor = fakeEditor({ value: true });
    scheduleTiptapFocusAndRestore(editor, () => CURSOR, vi.fn(), "tab-1");
    expect(isCaretRestorePending(editor)).toBe(true);
    runFrame();
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("stays pending across a retry, and settles when the view connects", () => {
    const connected = { value: false };
    const editor = fakeEditor(connected);
    scheduleTiptapFocusAndRestore(editor, () => CURSOR, vi.fn(), "tab-1");
    runFrame();
    expect(isCaretRestorePending(editor)).toBe(true);
    connected.value = true;
    runFrame();
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("settles when it gives up on a view that never connects", () => {
    const editor = fakeEditor({ value: false });
    scheduleTiptapFocusAndRestore(editor, () => CURSOR, vi.fn(), "tab-1");
    for (let i = 0; i < 50 && frames.length > 0; i += 1) runFrame();
    expect(frames).toHaveLength(0);
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("settles when the editor is destroyed before the frame", () => {
    const editor = fakeEditor({ value: true });
    scheduleTiptapFocusAndRestore(editor, () => CURSOR, vi.fn(), "tab-1");
    (editor as { isDestroyed: boolean }).isDestroyed = true;
    runFrame();
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("settles when focusing throws", () => {
    const editor = fakeEditor({ value: true }, () => {
      throw new Error("focus failed");
    });
    scheduleTiptapFocusAndRestore(editor, () => CURSOR, vi.fn(), "tab-1");
    runFrame();
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("settles when the cursor restore throws", () => {
    const editor = fakeEditor({ value: true });
    const restore = vi.fn(() => {
      throw new Error("restore failed");
    });
    scheduleTiptapFocusAndRestore(editor, () => CURSOR, restore, "tab-1");
    expect(() => runFrame()).toThrow("restore failed");
    expect(isCaretRestorePending(editor)).toBe(false);
  });
});

describe("Source restore — every exit settles", () => {
  const view = () => ({}) as CMView;

  it("is pending from schedule until the restore runs", () => {
    vi.useFakeTimers();
    const v = view();
    const restore = vi.fn();
    scheduleSourceFocusRestore(v, restore);
    expect(isCaretRestorePending(v)).toBe(true);
    vi.runAllTimers();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(isCaretRestorePending(v)).toBe(false);
  });

  it("settles when the restore throws", () => {
    vi.useFakeTimers();
    const v = view();
    scheduleSourceFocusRestore(v, () => {
      throw new Error("restore failed");
    });
    expect(() => vi.runAllTimers()).toThrow("restore failed");
    expect(isCaretRestorePending(v)).toBe(false);
  });

  it("settles, without running, when cancelled on unmount", () => {
    vi.useFakeTimers();
    const v = view();
    const restore = vi.fn();
    const cancel = scheduleSourceFocusRestore(v, restore);
    cancel();
    expect(isCaretRestorePending(v)).toBe(false);
    vi.runAllTimers();
    expect(restore).not.toHaveBeenCalled();
  });

  it("a cancel after it ran does not settle a later restore", () => {
    vi.useFakeTimers();
    const v = view();
    const cancelFirst = scheduleSourceFocusRestore(v, vi.fn());
    vi.runAllTimers();
    scheduleSourceFocusRestore(v, vi.fn());
    cancelFirst();
    expect(isCaretRestorePending(v)).toBe(true);
    vi.runAllTimers();
    expect(isCaretRestorePending(v)).toBe(false);
  });
});
