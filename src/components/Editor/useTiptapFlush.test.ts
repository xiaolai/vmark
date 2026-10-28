/**
 * The flush must tell the store whether a USER edit is behind it.
 *
 * Auto-save calls `flushActiveWysiwygNow()` on every tick BEFORE it reads
 * `isDirty`. If that flush claimed to be a user edit, the serializer's
 * canonical output (which is not byte-identical to arbitrary on-disk markdown)
 * would dirty a document nobody touched and auto-save would rewrite the file —
 * the "opening a file rewrites it" bug.
 *
 * `scheduleFlush` is the only user-edit signal available: the editor's
 * `onUpdate` is its sole caller and already drops programmatic transactions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Editor as TiptapEditor } from "@tiptap/core";

vi.mock("@/utils/markdownPipeline", () => ({
  serializeMarkdown: vi.fn(() => "SERIALIZED"),
}));

// WI-DP3.0 pilot — archetype "multi-store service". Both store mocks replaced
// by the real stores, set up together in beforeEach. Converting them ATOMICALLY
// matters: a store-by-store migration would have left this file reading one real
// store and one fake, a configuration that exists in no version of the code.
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

vi.mock("@/stores/documentStore", async () => ({
  useDocumentStore: { getState: () => ({ getDocument: () => ({ hardBreakStyle: "unknown" }) }) },
  // The REAL forced-Source marker: the refusal guard below reads it.
  useLargeFileSessionStore: (
    await vi.importActual<typeof import("@/stores/documentStore/largeFileSession")>(
      "@/stores/documentStore/largeFileSession",
    )
  ).useLargeFileSessionStore,
}));

import { useTiptapFlush } from "./useTiptapFlush";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { hasPendingWysiwygEdit } from "@/utils/wysiwygEditPending";
import { markContentApplied } from "@/services/editor/contentApplied";

/** Minimal editor stand-in — the flush only reads schema/state.doc. */
const editor = {
  schema: {},
  state: { doc: { content: { size: 10 } } },
} as unknown as TiptapEditor;
// Every test below is about an editor that holds its document; the one that
// does not is built separately.
markContentApplied(editor);

/** `tab: null` passes NO activeTabId. A defaulted parameter cannot express that:
 *  an explicit `undefined` argument takes the default, so the tab-store fallback
 *  was never reached by the test that claimed to watch it. */
function setup(
  setContent: (md: string, opts?: { fromUserEdit?: boolean }) => void,
  tab: string | null = "tab-1",
) {
  const activeTabId = tab ?? undefined;
  return renderHook(() =>
    useTiptapFlush({
      activeTabId,
      windowLabel: "main",
      setContent,
      preserveLineBreaksRef: { current: false },
      hardBreakStyleOnSaveRef: { current: "preserve" },
    }),
  );
}

// rAF is already stubbed below, but the LARGE-document branch takes the other
// path: a fire-and-forget `window.setTimeout(.., delay)` that calls
// `flushToStore`. On real timers a pending flush from one test can land during
// a later one and add a call nobody expects — the same shape that made
// useUpdateSync flaky. Faking the clock keeps that branch deterministic.
beforeEach(() => {
  useSettingsStore.setState({
    markdown: { ...useSettingsStore.getState().markdown, preserveBlankLines: false },
  });
  useTabStore.setState({ activeTabId: { main: "tab-1" } });
  useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("flushToStore user-edit reporting", () => {
  it("reports fromUserEdit: false when no edit preceded it (the auto-save tick)", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    result.current.flushToStore(editor);

    expect(setContent).toHaveBeenCalledWith("SERIALIZED", { fromUserEdit: false });
  });

  it("reports fromUserEdit: true after the editor scheduled a flush (a real edit)", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    result.current.scheduleFlush(editor); // onUpdate — user typed
    result.current.flushToStore(editor);

    expect(setContent).toHaveBeenCalledWith("SERIALIZED", { fromUserEdit: true });
  });

  it("consumes the signal — a later sync flush no longer claims a user edit", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    result.current.scheduleFlush(editor);
    result.current.flushToStore(editor);
    result.current.flushToStore(editor); // next auto-save tick, no new edit

    expect(setContent).toHaveBeenNthCalledWith(1, "SERIALIZED", { fromUserEdit: true });
    expect(setContent).toHaveBeenNthCalledWith(2, "SERIALIZED", { fromUserEdit: false });
  });

  it("does not lose an edit whose debounce has not fired yet", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    // User types (flush scheduled, still pending) and auto-save flushes first.
    result.current.scheduleFlush(editor);
    result.current.flushToStore(editor);

    expect(setContent).toHaveBeenCalledWith("SERIALIZED", { fromUserEdit: true });
  });

  it("a sync flush cancels a large document's pending debounce, so the edit is written once", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);
    const large = { schema: {}, state: { doc: { content: { size: 200_000 } } } } as unknown as TiptapEditor;
    markContentApplied(large);

    result.current.scheduleFlush(large); // 1 s debounce armed
    result.current.flushToStore(large); // Save flushes first
    vi.advanceTimersByTime(10_000);

    expect(setContent).toHaveBeenCalledTimes(1);
    expect(result.current.pendingDebounceTimeout.current).toBeNull();
  });

  it("repeated sync flushes never claim a user edit", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    for (let i = 0; i < 3; i++) result.current.flushToStore(editor);

    for (const call of setContent.mock.calls) {
      expect(call[1]).toEqual({ fromUserEdit: false });
    }
  });

  // Audit 019fe61c: the real-store setup above was PRESENT but not OBSERVED —
  // every hook got `activeTabId: "tab-1"`, so the tabStore fallback at
  // useTiptapFlush.ts:100 never ran, and the serializer mock discarded its
  // options, so nothing proved `preserveBlankLines` came from the settings
  // store. Both paths would have regressed silently. These two watch them.
  it("reads preserveBlankLines from the real settings store", async () => {
    const { serializeMarkdown } = await import("@/utils/markdownPipeline");
    useSettingsStore.setState({
      markdown: { ...useSettingsStore.getState().markdown, preserveBlankLines: true },
    });
    const { result } = setup(vi.fn());

    result.current.flushToStore(editor);

    expect(vi.mocked(serializeMarkdown).mock.calls.at(-1)?.[2]).toMatchObject({
      preserveBlankLines: true,
    });
  });

  it("falls back to the tab store's active tab when no activeTabId is passed", async () => {
    const { serializeMarkdown } = await import("@/utils/markdownPipeline");
    useTabStore.setState({ activeTabId: { main: "tab-from-store" } });
    const { result } = setup(vi.fn(), null);

    result.current.flushToStore(editor);

    // The fallback resolved a tab id from the REAL store: serialization ran and
    // produced a resolved hardBreakStyle rather than bailing on a missing tab.
    expect(vi.mocked(serializeMarkdown)).toHaveBeenCalled();
    expect(vi.mocked(serializeMarkdown).mock.calls.at(-1)?.[2]).toHaveProperty("hardBreakStyle");
  });
});

// #1407: once the editor has failed to parse its tab's document, what it holds
// is NOT that document — it is empty (initial load) or stale (a refused external
// change). Any write from it would overwrite the real text: the pending edit's
// debounce, Save's flush, and the unmount flush that runs as the tab switches to
// Source mode. Reproduced by the audit as the store ending up "stale edit".
// WI-OC1.1 — Save and Save All flush through the registered flusher, which can
// run between the editor's mount and its deferred initial load. The editor
// then holds an empty placeholder; serializing it replaced the tab's text with
// "" in the store, and the load's drift check then emptied the editor too.
describe("flushToStore before the editor holds its document", () => {
  it("writes nothing", () => {
    const placeholder = {
      schema: {},
      state: { doc: { content: { size: 2 } } },
    } as unknown as TiptapEditor;
    const setContent = vi.fn();
    const { result } = setup(setContent);
    result.current.flushToStore(placeholder);
    expect(setContent).not.toHaveBeenCalled();
  });

  it("writes once the editor holds it", () => {
    const loaded = {
      schema: {},
      state: { doc: { content: { size: 2 } } },
    } as unknown as TiptapEditor;
    const setContent = vi.fn();
    const { result } = setup(setContent);
    markContentApplied(loaded);
    result.current.flushToStore(loaded);
    expect(setContent).toHaveBeenCalledWith("SERIALIZED", { fromUserEdit: false });
  });
});

describe("flushToStore after the tab's document was refused", () => {
  it("writes nothing — not a scheduled edit, not a save or unmount flush", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    result.current.scheduleFlush(editor); // a keystroke is pending
    useLargeFileSessionStore.getState().markForcedSource("tab-1", "unparseable");
    result.current.flushToStore(editor);
    vi.runAllTimers();

    expect(setContent).not.toHaveBeenCalled();
  });

  it("still writes for a tab in Source mode only because it is large", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    useLargeFileSessionStore.getState().markForcedSource("tab-1", "large-file");
    result.current.flushToStore(editor);

    expect(setContent).toHaveBeenCalledTimes(1);
  });

  it("writes again once the refusal is cleared", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    useLargeFileSessionStore.getState().markForcedSource("tab-1", "unparseable");
    result.current.flushToStore(editor);
    useLargeFileSessionStore.getState().clearForcedSource("tab-1");
    result.current.flushToStore(editor);

    expect(setContent).toHaveBeenCalledTimes(1);
  });

  it("guards the tab-store fallback too", () => {
    const setContent = vi.fn();
    useTabStore.setState({ activeTabId: { main: "tab-from-store" } });
    const { result } = setup(setContent, null);

    useLargeFileSessionStore.getState().markForcedSource("tab-from-store", "unparseable");
    result.current.flushToStore(editor);

    expect(setContent).not.toHaveBeenCalled();
  });
});

// WI-RA10B.7 — auto-save reads this signal instead of flushing on every tick,
// so it must be up exactly while an edit exists only in the editor.
describe("the edit-pending signal auto-save reads", () => {
  it("is down for an editor nobody has typed in", () => {
    const { unmount } = setup(vi.fn());
    expect(hasPendingWysiwygEdit()).toBe(false);
    unmount();
  });

  it("goes up in the same call that schedules the flush, before any timer fires", () => {
    const { result, unmount } = setup(vi.fn());
    result.current.scheduleFlush(editor);
    expect(hasPendingWysiwygEdit()).toBe(true);
    unmount();
  });

  it("goes down when a flush writes the edit to the store", () => {
    const setContent = vi.fn();
    const { result, unmount } = setup(setContent);
    result.current.scheduleFlush(editor);
    result.current.flushToStore(editor);

    expect(setContent).toHaveBeenCalledWith("SERIALIZED", { fromUserEdit: true });
    expect(hasPendingWysiwygEdit()).toBe(false);
    unmount();
  });

  it("goes down when the flush is refused for an unparseable document", () => {
    const { result, unmount } = setup(vi.fn());
    result.current.scheduleFlush(editor);
    useLargeFileSessionStore.getState().markForcedSource("tab-1", "unparseable");
    result.current.flushToStore(editor);

    expect(hasPendingWysiwygEdit()).toBe(false);
    unmount();
  });

  it("stays up for one editor while another flushes", () => {
    const first = setup(vi.fn());
    const second = setup(vi.fn(), "tab-2");
    first.result.current.scheduleFlush(editor);
    second.result.current.scheduleFlush(editor);
    second.result.current.flushToStore(editor);

    expect(hasPendingWysiwygEdit()).toBe(true);
    first.unmount();
    second.unmount();
  });

  it("goes down when the editor unmounts with its edit unflushed", () => {
    const { result, unmount } = setup(vi.fn());
    result.current.scheduleFlush(editor);
    unmount();
    expect(hasPendingWysiwygEdit()).toBe(false);
  });
});

describe("timer handles are compared with their null sentinel", () => {
  it("cancels a pending RAF whose handle is 0 when flushing now", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
    const setContent = vi.fn();
    const { result } = setup(setContent);

    result.current.scheduleFlush(editor);
    expect(result.current.pendingRaf.current).toBe(0);
    result.current.flushToStore(editor);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
    expect(result.current.pendingRaf.current).toBeNull();
  });

  it("cancels a pending RAF whose handle is 0 when a newer edit reschedules", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
    const { result } = setup(vi.fn());

    result.current.scheduleFlush(editor);
    result.current.scheduleFlush(editor);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
  });

  it("cancels the internal-change reset RAF whose handle is 0 before scheduling another", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
    const { result } = setup(vi.fn());

    result.current.flushToStore(editor);
    result.current.flushToStore(editor);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
  });
});
