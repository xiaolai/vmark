// WI-AL1.7 — useJournalFeed: a value is only returned for the activation it was read in, so a panel that leaves a document (another document, or none) and comes back never shows the value read before it left; `refresh` re-reads through the feed, one reader at a time; the poll interval is derived from the value just read, so a feed polls while its value asks for it and stops once it no longer does; a listener that cannot be registered leaves the read healthy and the value follows by polling
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
  emit: vi.fn(async () => undefined),
}));

import { listen } from "@tauri-apps/api/event";
import { useJournalFeed } from "../useJournalFeed";
import { FEED_POLL_MS } from "@/services/agentJournal/journalFeed";

const replies = vi.hoisted(() => ({ value: "first" }));
const fetch = vi.fn<(key: string) => Promise<string>>();

beforeEach(() => {
  vi.mocked(listen).mockImplementation(async () => () => undefined);
  replies.value = "first";
  fetch.mockReset();
  fetch.mockImplementation(async (key) => `${key}:${replies.value}`);
});

describe("useJournalFeed", () => {
  it("reads the key and returns its value", async () => {
    const { result } = renderHook(() => useJournalFeed("a", fetch));
    await waitFor(() => expect(result.current).toMatchObject({ value: "a:first", failed: false, loaded: true }));
  });

  it("a null key reads nothing", () => {
    const { result } = renderHook(() => useJournalFeed(null, fetch));
    expect(result.current).toMatchObject({ value: null, failed: false, loaded: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaving a key for none and coming back does not show the value read before", async () => {
    const { result, rerender } = renderHook(({ k }: { k: string | null }) => useJournalFeed(k, fetch), {
      initialProps: { k: "a" as string | null },
    });
    await waitFor(() => expect(result.current.value).toBe("a:first"));
    rerender({ k: null });
    let hold: (v: string) => void = () => undefined;
    fetch.mockImplementationOnce(() => new Promise((resolve) => (hold = resolve)));
    rerender({ k: "a" });
    expect(result.current).toMatchObject({ value: null, failed: false, loaded: false });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => hold("a:second"));
    expect(result.current.value).toBe("a:second");
  });

  it("leaving a key for another and coming back before it answers does not show the first value", async () => {
    const { result, rerender } = renderHook(({ k }: { k: string }) => useJournalFeed(k, fetch), {
      initialProps: { k: "a" },
    });
    await waitFor(() => expect(result.current.value).toBe("a:first"));
    let hold: (v: string) => void = () => undefined;
    fetch.mockImplementation((key) =>
      key === "a" ? new Promise((resolve) => (hold = resolve)) : new Promise(() => undefined),
    );
    rerender({ k: "b" });
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("b"));
    rerender({ k: "a" });
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("a"));
    await act(async () => hold("a:second"));
    expect(result.current.value).toBe("a:second");
  });

  it("refresh re-reads and keeps the current value meanwhile", async () => {
    const { result } = renderHook(() => useJournalFeed("a", fetch));
    await waitFor(() => expect(result.current.value).toBe("a:first"));
    replies.value = "second";
    act(() => result.current.refresh());
    expect(result.current.value).toBe("a:first");
    await waitFor(() => expect(result.current.value).toBe("a:second"));
  });

  describe("polling", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    const pollWhileFirst = (v: string | null) => (v?.endsWith("first") ? FEED_POLL_MS : null);

    it("polls while the value asks for it, then stops", async () => {
      const { result } = renderHook(() => useJournalFeed("a", fetch, pollWhileFirst));
      await tick(0);
      expect(result.current.value).toBe("a:first");
      // Asking to poll restarts the feed once (one immediate read); then one read per interval.
      const settled = fetch.mock.calls.length;
      await tick(FEED_POLL_MS);
      expect(fetch).toHaveBeenCalledTimes(settled + 1);
      replies.value = "second";
      await tick(FEED_POLL_MS);
      expect(result.current.value).toBe("a:second");
      const calls = fetch.mock.calls.length;
      await tick(FEED_POLL_MS * 3);
      expect(fetch).toHaveBeenCalledTimes(calls);
    });

    it("a listener that cannot be registered: the read stays healthy and the value still follows by polling", async () => {
      vi.mocked(listen).mockImplementation(() => Promise.reject(new Error("no event bridge")));
      const { result } = renderHook(() => useJournalFeed("a", fetch));
      await tick(0);
      expect(result.current).toMatchObject({ value: "a:first", failed: false, loaded: true });
      replies.value = "second";
      await tick(FEED_POLL_MS);
      expect(result.current).toMatchObject({ value: "a:second", failed: false });
    });

    it("does not poll without a poll function", async () => {
      renderHook(() => useJournalFeed("a", fetch));
      await tick(FEED_POLL_MS * 3);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
