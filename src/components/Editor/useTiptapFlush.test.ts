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

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ getDocument: () => ({ hardBreakStyle: "unknown" }) }) },
}));

import { useTiptapFlush } from "./useTiptapFlush";

/** Minimal editor stand-in — the flush only reads schema/state.doc. */
const editor = {
  schema: {},
  state: { doc: { content: { size: 10 } } },
} as unknown as TiptapEditor;

function setup(setContent: (md: string, opts?: { fromUserEdit?: boolean }) => void) {
  return renderHook(() =>
    useTiptapFlush({
      activeTabId: "tab-1",
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

  it("repeated sync flushes never claim a user edit", () => {
    const setContent = vi.fn();
    const { result } = setup(setContent);

    for (let i = 0; i < 3; i++) result.current.flushToStore(editor);

    for (const call of setContent.mock.calls) {
      expect(call[1]).toEqual({ fromUserEdit: false });
    }
  });
});
