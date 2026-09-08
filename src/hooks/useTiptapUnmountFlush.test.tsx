// WI-FL5.1 — useTiptapUnmountFlush: on unmount, pending WYSIWYG content is
// flushed BEFORE the timers that would have flushed it are cancelled (#755;
// ledger F7, editor-lifecycle-hooks). Keystrokes inside the debounce window
// live only in ProseMirror's doc, so cancelling first loses them.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useTiptapUnmountFlush } from "./useTiptapUnmountFlush";

const editor = new Editor({ extensions: [StarterKit], content: "<p>draft</p>" });
afterAll(() => editor.destroy());

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}

type Flusher = (e: Editor) => void;

function makeRefs(opts: { editor?: Editor | null; flush?: Flusher | null } = {}) {
  return {
    pendingRaf: ref<number | null>(null),
    pendingDebounceTimeout: ref<number | null>(null),
    pendingCursorRaf: ref<number | null>(null),
    internalChangeRaf: ref<number | null>(null),
    trackingTimeoutId: ref<number | null>(null),
    cvIdleTimeoutRef: ref<number | null>(null),
    editorRef: ref<Editor | null>(opts.editor === undefined ? editor : opts.editor),
    flushToStoreRef: ref<Flusher | null>(opts.flush === undefined ? vi.fn() : opts.flush),
  };
}

type Refs = ReturnType<typeof makeRefs>;

/** Every timer/RAF slot the hook owns, so a test can prove all were emptied. */
function timerSlots(refs: Refs): Array<number | null> {
  return [
    refs.pendingRaf.current,
    refs.pendingDebounceTimeout.current,
    refs.pendingCursorRaf.current,
    refs.internalChangeRaf.current,
    refs.trackingTimeoutId.current,
    refs.cvIdleTimeoutRef.current,
  ];
}

// The hook cancels through the bare globals AND through `window.*`; under
// jsdom those may or may not be the same function, so both are observed.
let cancelled: Array<{ kind: "raf" | "timeout"; id: unknown }> = [];
let events: string[] = [];

beforeEach(() => {
  cancelled = [];
  events = [];
  const recordRaf = (id: unknown) => {
    cancelled.push({ kind: "raf", id });
    events.push("cancel");
  };
  const recordTimeout = (id: unknown) => {
    cancelled.push({ kind: "timeout", id });
    events.push("cancel");
  };
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(recordRaf);
  vi.spyOn(globalThis, "clearTimeout").mockImplementation(recordTimeout as typeof clearTimeout);
  if (window.cancelAnimationFrame !== globalThis.cancelAnimationFrame) {
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(recordRaf);
  }
  if (window.clearTimeout !== globalThis.clearTimeout) {
    vi.spyOn(window, "clearTimeout").mockImplementation(recordTimeout as typeof clearTimeout);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ids = (kind: "raf" | "timeout") => cancelled.filter((c) => c.kind === kind).map((c) => c.id);

describe("useTiptapUnmountFlush (#755)", () => {
  it("flushes pending debounced content through this instance's editor BEFORE cancelling anything", () => {
    const refs = makeRefs({ flush: null });
    const flush = vi.fn((e: Editor) => {
      events.push("flush");
      expect(e).toBe(editor);
      // Nothing has been cancelled yet when the flush runs.
      expect(refs.pendingDebounceTimeout.current).toBe(42);
      expect(cancelled).toHaveLength(0);
    });
    refs.flushToStoreRef.current = flush;
    refs.pendingDebounceTimeout.current = 42;
    refs.pendingRaf.current = 7;

    const { unmount } = renderHook(() => useTiptapUnmountFlush(refs));
    expect(flush).not.toHaveBeenCalled(); // mount does nothing

    unmount();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(events[0]).toBe("flush");
    expect(events.slice(1).every((e) => e === "cancel")).toBe(true);
    expect(ids("raf")).toContain(7);
    expect(ids("timeout")).toContain(42);
    expect(timerSlots(refs)).toEqual([null, null, null, null, null, null]);
  });

  it("a pending RAF alone also means unflushed content — it is flushed too", () => {
    const flush = vi.fn();
    const refs = makeRefs({ flush });
    refs.pendingRaf.current = 11;

    const { unmount } = renderHook(() => useTiptapUnmountFlush(refs));
    unmount();

    expect(flush).toHaveBeenCalledWith(editor);
    expect(ids("raf")).toContain(11);
    expect(refs.pendingRaf.current).toBeNull();
  });

  it("with nothing pending there is nothing to flush, but every other timer is still cancelled", () => {
    const flush = vi.fn();
    const refs = makeRefs({ flush });
    refs.pendingCursorRaf.current = 21;
    refs.internalChangeRaf.current = 22;
    refs.trackingTimeoutId.current = 23;
    refs.cvIdleTimeoutRef.current = 24;

    const { unmount } = renderHook(() => useTiptapUnmountFlush(refs));
    unmount();

    expect(flush).not.toHaveBeenCalled();
    expect(ids("raf")).toEqual(expect.arrayContaining([21, 22]));
    expect(ids("timeout")).toEqual(expect.arrayContaining([23, 24]));
    expect(timerSlots(refs)).toEqual([null, null, null, null, null, null]);
  });

  it("a tracking timeout of 0 is a real id and is still cleared (the !== null check)", () => {
    const refs = makeRefs();
    refs.trackingTimeoutId.current = 0;
    refs.cvIdleTimeoutRef.current = 0;

    const { unmount } = renderHook(() => useTiptapUnmountFlush(refs));
    unmount();

    expect(ids("timeout").filter((id) => id === 0)).toHaveLength(2);
    expect(refs.trackingTimeoutId.current).toBeNull();
    expect(refs.cvIdleTimeoutRef.current).toBeNull();
  });

  it("no editor (or no flusher) means no flush, yet the pending timers are still cancelled", () => {
    const noEditor = makeRefs({ editor: null });
    noEditor.pendingDebounceTimeout.current = 31;
    const { unmount: unmountA } = renderHook(() => useTiptapUnmountFlush(noEditor));
    unmountA();
    expect(noEditor.flushToStoreRef.current).toHaveBeenCalledTimes(0);
    expect(ids("timeout")).toContain(31);

    const noFlusher = makeRefs({ flush: null });
    noFlusher.pendingRaf.current = 32;
    const { unmount: unmountB } = renderHook(() => useTiptapUnmountFlush(noFlusher));
    expect(() => unmountB()).not.toThrow();
    expect(ids("raf")).toContain(32);
  });

  it("a throwing flush is reported and does not stop the timers from being cancelled", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const flush = vi.fn(() => {
      throw new Error("serialize failed");
    });
    const refs = makeRefs({ flush });
    refs.pendingDebounceTimeout.current = 51;
    refs.pendingRaf.current = 52;

    const { unmount } = renderHook(() => useTiptapUnmountFlush(refs));
    expect(() => unmount()).not.toThrow();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[Tiptap]"),
      expect.stringContaining("Unmount flush failed"),
      expect.any(Error),
    );
    expect(ids("timeout")).toContain(51);
    expect(ids("raf")).toContain(52);
    expect(timerSlots(refs)).toEqual([null, null, null, null, null, null]);
  });

  it("reads the LATEST editor and flusher at unmount time, not a mount-time snapshot", () => {
    const stale = vi.fn();
    const refs = makeRefs({ flush: stale });
    const { unmount } = renderHook(() => useTiptapUnmountFlush(refs));

    // Both refs are swapped after mount — exactly what the ref-based design
    // exists to honour (#755).
    const live = vi.fn();
    const liveEditor = new Editor({ extensions: [StarterKit] });
    refs.flushToStoreRef.current = live;
    refs.editorRef.current = liveEditor;
    refs.pendingDebounceTimeout.current = 61;

    unmount();

    expect(stale).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledWith(liveEditor);
    liveEditor.destroy();
  });

  it("re-renders never run the cleanup — the effect is mount-once / cleanup-on-unmount", () => {
    const flush = vi.fn();
    const refs = makeRefs({ flush });
    refs.pendingDebounceTimeout.current = 71;

    const { rerender, unmount } = renderHook(() => useTiptapUnmountFlush(refs));
    rerender();
    rerender();
    expect(flush).not.toHaveBeenCalled();
    expect(refs.pendingDebounceTimeout.current).toBe(71);

    unmount();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("useTiptapUnmountFlush — the #755 mechanism end to end", () => {
  it("content in the debounce window is flushed synchronously at unmount, and the debounced flush never fires", async () => {
    vi.restoreAllMocks(); // real timers for this one
    const flush = vi.fn();
    const refs = makeRefs({ flush });
    const debounced = vi.fn();
    refs.pendingDebounceTimeout.current = window.setTimeout(debounced, 30);

    const { unmount } = renderHook(() => useTiptapUnmountFlush(refs));
    unmount();

    // Flushed right away, through this editor — before the timer could.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(editor);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(debounced).not.toHaveBeenCalled(); // cancelled, not merely raced
    expect(refs.pendingDebounceTimeout.current).toBeNull();
  });
});
