// WI-FL5.1 — useWysiwygFlusherRegistration: the save / Save-All flushers are
// registered only for a VISIBLE, NON-PREVIEW editor (ledger F7,
// editor-lifecycle-hooks). Observed through the real registry: does a save
// flush reach this editor's flushToStore, or not.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  flushActiveWysiwygNow,
  flushAllWysiwygNow,
  registerActiveWysiwygFlusher,
  registerWysiwygFlusher,
} from "@/utils/wysiwygFlush";
import { useWysiwygFlusherRegistration } from "./useWysiwygFlusherRegistration";

// Identity is all the hook needs from the editor; a real one keeps the test
// honest about the type without a cast.
const editorA = new Editor({ extensions: [StarterKit] });
const editorB = new Editor({ extensions: [StarterKit] });
afterAll(() => {
  editorA.destroy();
  editorB.destroy();
});

const TAB_A = "tab-a";
const TAB_B = "tab-b";

afterEach(() => {
  // The registry is module-level state; leave it empty for the next test.
  registerActiveWysiwygFlusher(null);
  registerWysiwygFlusher(TAB_A, null);
  registerWysiwygFlusher(TAB_B, null);
});

const visible = (flushToStore: (e: Editor) => void, activeTabId: string = TAB_A) => ({
  flushToStore,
  hidden: false,
  preview: false,
  activeTabId: activeTabId as string | undefined,
});

describe("useWysiwygFlusherRegistration", () => {
  it("a visible editor is reached by both the per-tab save flush and Save-All", () => {
    const flushToStore = vi.fn();
    renderHook(() => useWysiwygFlusherRegistration(editorA, visible(flushToStore)));

    flushActiveWysiwygNow();
    expect(flushToStore).toHaveBeenCalledTimes(1);
    expect(flushToStore).toHaveBeenCalledWith(editorA);

    flushAllWysiwygNow();
    expect(flushToStore).toHaveBeenCalledTimes(2);
  });

  it("a hidden editor is reached by neither", () => {
    const flushToStore = vi.fn();
    renderHook(() => useWysiwygFlusherRegistration(editorA, { ...visible(flushToStore), hidden: true }));

    flushActiveWysiwygNow();
    flushAllWysiwygNow();
    expect(flushToStore).not.toHaveBeenCalled();
  });

  it("a PREVIEW editor is reached by neither — it must never serialize over the source markdown", () => {
    const flushToStore = vi.fn();
    renderHook(() => useWysiwygFlusherRegistration(editorA, { ...visible(flushToStore), preview: true }));

    flushActiveWysiwygNow();
    flushAllWysiwygNow();
    expect(flushToStore).not.toHaveBeenCalled();
  });

  it("registers nothing while the editor is still null", () => {
    const flushToStore = vi.fn();
    renderHook(() => useWysiwygFlusherRegistration(null, visible(flushToStore)));

    flushActiveWysiwygNow();
    flushAllWysiwygNow();
    expect(flushToStore).not.toHaveBeenCalled();
  });

  it("unmounting deregisters both, so a later save cannot flush into a dead editor", () => {
    const flushToStore = vi.fn();
    const { unmount } = renderHook(() => useWysiwygFlusherRegistration(editorA, visible(flushToStore)));
    unmount();

    flushActiveWysiwygNow();
    flushAllWysiwygNow();
    expect(flushToStore).not.toHaveBeenCalled();
  });

  it("without an active tab id only the per-tab save flush is registered — Save-All needs a key", () => {
    const flushToStore = vi.fn();
    renderHook(() =>
      useWysiwygFlusherRegistration(editorA, { ...visible(flushToStore), activeTabId: undefined }),
    );

    flushActiveWysiwygNow();
    expect(flushToStore).toHaveBeenCalledTimes(1);

    flushAllWysiwygNow();
    expect(flushToStore).toHaveBeenCalledTimes(1);
  });

  it("follows visibility: hidden → visible registers, visible → hidden deregisters", () => {
    const flushToStore = vi.fn();
    const { rerender } = renderHook(
      (props: { hidden: boolean }) => useWysiwygFlusherRegistration(editorA, { ...visible(flushToStore), hidden: props.hidden }),
      { initialProps: { hidden: true } },
    );

    flushActiveWysiwygNow();
    expect(flushToStore).not.toHaveBeenCalled();

    rerender({ hidden: false });
    flushActiveWysiwygNow();
    expect(flushToStore).toHaveBeenCalledTimes(1);

    rerender({ hidden: true });
    flushActiveWysiwygNow();
    flushAllWysiwygNow();
    expect(flushToStore).toHaveBeenCalledTimes(1);
  });

  it("Save-All reaches EVERY mounted editor (a split's two panes), not just the active one", () => {
    const flushA = vi.fn();
    const flushB = vi.fn();
    renderHook(() => useWysiwygFlusherRegistration(editorA, visible(flushA, TAB_A)));
    renderHook(() => useWysiwygFlusherRegistration(editorB, visible(flushB, TAB_B)));

    flushAllWysiwygNow();
    expect(flushA).toHaveBeenCalledWith(editorA);
    expect(flushB).toHaveBeenCalledWith(editorB);

    // The single "active" slot belongs to the most recently registered editor.
    flushActiveWysiwygNow();
    expect(flushB).toHaveBeenCalledTimes(2);
    expect(flushA).toHaveBeenCalledTimes(1);
  });

  it("a new flushToStore identity replaces the old registration rather than stacking on it", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      (props: { flush: (e: Editor) => void }) => useWysiwygFlusherRegistration(editorA, visible(props.flush)),
      { initialProps: { flush: first } },
    );
    rerender({ flush: second });

    flushActiveWysiwygNow();
    flushAllWysiwygNow();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
  });
});
