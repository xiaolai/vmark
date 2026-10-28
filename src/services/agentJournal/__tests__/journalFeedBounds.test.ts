// @vitest-environment node
// WI-AL1.7 — a feed recovers from a journal or event bridge that never answers: a read that never settles fails at the journal deadline (reported, then retried with backoff); a listener registration that never settles counts as failed at its bound, so the feed still reads, polls while deaf and tries the registration again, and a hung registration that resolves later is released when another already listens
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listen, type EventCallback } from "@tauri-apps/api/event";
import { JOURNAL_DEADLINE_MS } from "../journalDeadline";
import { FEED_LISTEN_BOUND_MS, FEED_POLL_MS, FEED_RETRY_MS, startJournalFeed } from "../journalFeed";

const listenMock = vi.mocked(listen);
const never = <T>() => new Promise<T>(() => {});

beforeEach(() => {
  listenMock.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("a journal feed bounds what it waits for", () => {
  it("fails a read that never settles at the journal deadline, then retries it", async () => {
    listenMock.mockResolvedValue(vi.fn());
    const fetch = vi.fn<() => Promise<number>>().mockImplementationOnce(never).mockResolvedValue(7);
    const apply = vi.fn();
    const onError = vi.fn();
    startJournalFeed(fetch, apply, onError);
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS + 1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ journalCode: "JOURNAL_TIMEOUT" }));
    await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
    expect(apply).toHaveBeenCalledWith(7);
  });

  it("reads, polls and retries the registration when a listen never settles", async () => {
    const unlisten = vi.fn();
    let late!: (fn: () => void) => void;
    listenMock
      .mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
      .mockImplementation((_e, _cb: EventCallback<unknown>) => Promise.resolve(vi.fn()));
    const fetch = vi.fn(() => Promise.resolve(1));
    startJournalFeed(fetch, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(FEED_LISTEN_BOUND_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
    expect(listenMock).toHaveBeenCalledTimes(2);
    // The hung registration answers after the retry already listens: released.
    late(unlisten);
    await vi.advanceTimersByTimeAsync(0);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("listens on a hung registration that answers before its retry, and cancels the retry", async () => {
    let late!: (fn: () => void) => void;
    listenMock.mockImplementationOnce(() => new Promise((resolve) => (late = resolve)));
    const fetch = vi.fn(() => Promise.resolve(1));
    const feed = startJournalFeed(fetch, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(FEED_LISTEN_BOUND_MS);
    const unlisten = vi.fn();
    late(unlisten);
    await vi.advanceTimersByTimeAsync(FEED_RETRY_MS + FEED_POLL_MS);
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2); // the first read, then the catch-up once it listens
    feed.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("polls while a hung registration is still pending", async () => {
    listenMock.mockImplementation(never);
    const fetch = vi.fn(() => Promise.resolve(1));
    startJournalFeed(fetch, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(FEED_LISTEN_BOUND_MS + FEED_POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
