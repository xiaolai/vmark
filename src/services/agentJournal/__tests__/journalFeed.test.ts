// @vitest-environment node
// WI-AL1.7 — live history across windows: the panel listens for the journal generation broadcast BEFORE its first read, so an append between the read and the listener is never lost; an event during a read schedules exactly one more read (never two at once, so an older reply never lands after a newer one); a burst is one re-read; a failed read is retried without another append; a listener that cannot be registered is not a read failure: the feed polls while it is not listening and retries the registration with backoff, and once it listens the events drive the reads again; a stopped feed applies nothing and releases its listener even when the listen resolves late; the event name matches the Rust broadcaster's; with a poll interval (live updates not running) the view is re-read on that interval without any event, a read prompted by an event restarts the interval rather than adding a second reader, and a stopped feed polls no more
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

import { listen, type EventCallback } from "@tauri-apps/api/event";
import { GENERATION_EVENT, FEED_POLL_MS, FEED_RETRY_MS, startJournalFeed } from "../journalFeed";

const listenMock = vi.mocked(listen);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let handler: EventCallback<unknown> | null;
let unlisten: ReturnType<typeof vi.fn<() => void>>;
let listened: ReturnType<typeof deferred<() => void>>;

beforeEach(() => {
  handler = null;
  unlisten = vi.fn<() => void>();
  listened = deferred<() => void>();
  listenMock.mockReset();
  listenMock.mockImplementation((_event, cb) => {
    handler = cb as EventCallback<unknown>;
    return listened.promise;
  });
});

afterEach(() => vi.useRealTimers());

const fire = (generation: string | null) =>
  handler?.({ event: GENERATION_EVENT, id: 1, payload: { generation } } as never);

describe("startJournalFeed", () => {
  it("names the event the Rust broadcaster emits", () => {
    const rust = readFileSync(new URL("../../../../src-tauri/src/agent_journal/generation_events.rs", import.meta.url), "utf8");
    expect(rust).toContain(`pub const GENERATION_EVENT: &str = "${GENERATION_EVENT}";`);
  });

  it("registers the listener before the first read", async () => {
    const fetch = vi.fn(() => Promise.resolve(1));
    const apply = vi.fn();
    startJournalFeed(fetch, apply, vi.fn());
    expect(listenMock).toHaveBeenCalledWith(GENERATION_EVENT, expect.any(Function));
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    listened.resolve(unlisten);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(1);
  });

  it("an event during a read schedules one more read, never a concurrent one", async () => {
    const reads = [deferred<number>(), deferred<number>()];
    let n = 0;
    const fetch = vi.fn(() => reads[n++].promise);
    const apply = vi.fn();
    startJournalFeed(fetch, apply, vi.fn());
    listened.resolve(unlisten);
    await flush();
    fire("11");
    fire("12");
    fire("13");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    reads[0].resolve(10);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    reads[1].resolve(13);
    await flush();
    expect(apply.mock.calls).toEqual([[10], [13]]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("an event after the read settles reads again", async () => {
    const fetch = vi.fn(() => Promise.resolve(1));
    startJournalFeed(fetch, vi.fn(), vi.fn());
    listened.resolve(unlisten);
    await flush();
    fire("2");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a failed start announcement still reads (the read reports the journal unavailable)", async () => {
    const fetch = vi.fn(() => Promise.resolve(1));
    startJournalFeed(fetch, vi.fn(), vi.fn());
    listened.resolve(unlisten);
    await flush();
    fire(null);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a failed read without another append", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(5);
    const apply = vi.fn();
    const onError = vi.fn();
    startJournalFeed(fetch, apply, onError);
    listened.resolve(unlisten);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
    await flush();
    expect(apply).toHaveBeenCalledWith(5);
  });

  describe("a listener that cannot be registered", () => {
    const refuseOnce = () =>
      listenMock.mockImplementationOnce(() => Promise.reject(new Error("no event bridge")));

    it("reads at once, and a listener failure is not a read failure", async () => {
      vi.useFakeTimers();
      refuseOnce();
      const fetch = vi.fn(() => Promise.resolve(1));
      const onError = vi.fn();
      startJournalFeed(fetch, vi.fn(), onError);
      await flush();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it("polls while it is not listening, so another window's change still arrives", async () => {
      vi.useFakeTimers();
      listenMock.mockImplementation(() => Promise.reject(new Error("no event bridge")));
      let n = 0;
      const apply = vi.fn();
      startJournalFeed(() => Promise.resolve(++n), apply, vi.fn());
      await flush();
      expect(apply.mock.calls).toEqual([[1]]);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      expect(apply.mock.calls).toEqual([[1], [2]]);
    });

    it("retries the registration with backoff; once it listens, events drive the reads and polling stops", async () => {
      vi.useFakeTimers();
      refuseOnce();
      refuseOnce();
      const fetch = vi.fn(() => Promise.resolve(1));
      startJournalFeed(fetch, vi.fn(), vi.fn());
      await flush();
      expect(listenMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
      expect(listenMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
      expect(listenMock).toHaveBeenCalledTimes(2); // backed off: the next try waits twice as long
      await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
      expect(listenMock).toHaveBeenCalledTimes(3);
      listened.resolve(unlisten);
      await flush();
      const reads = fetch.mock.calls.length;
      fire("2");
      await flush();
      expect(fetch).toHaveBeenCalledTimes(reads + 1);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 3);
      expect(fetch).toHaveBeenCalledTimes(reads + 1);
    });

    it("keeps the caller's own interval while not listening", async () => {
      vi.useFakeTimers();
      listenMock.mockImplementation(() => Promise.reject(new Error("no event bridge")));
      const fetch = vi.fn(() => Promise.resolve(1));
      startJournalFeed(fetch, vi.fn(), vi.fn(), FEED_POLL_MS * 2);
      await flush();
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("a stopped feed neither polls nor retries the registration", async () => {
      vi.useFakeTimers();
      listenMock.mockImplementation(() => Promise.reject(new Error("no event bridge")));
      const fetch = vi.fn(() => Promise.resolve(1));
      const feed = startJournalFeed(fetch, vi.fn(), vi.fn());
      await flush();
      feed.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(listenMock).toHaveBeenCalledTimes(1);
    });

    it("a registration that succeeds after stop() is released at once", async () => {
      vi.useFakeTimers();
      refuseOnce();
      const feed = startJournalFeed(() => Promise.resolve(1), vi.fn(), vi.fn());
      await flush();
      await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
      expect(listenMock).toHaveBeenCalledTimes(2);
      feed.stop();
      listened.resolve(unlisten);
      await flush();
      expect(unlisten).toHaveBeenCalledTimes(1);
    });
  });

  it("a stopped feed reports nothing when its listener registration rejects late", async () => {
    const fetch = vi.fn(() => Promise.resolve(1));
    const onError = vi.fn();
    const feed = startJournalFeed(fetch, vi.fn(), onError);
    feed.stop();
    listened.reject(new Error("no event bridge"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a stopped feed applies nothing and releases a listener that resolves late", async () => {
    const read = deferred<number>();
    const apply = vi.fn();
    const feed = startJournalFeed(() => read.promise, apply, vi.fn());
    feed.stop();
    listened.resolve(unlisten);
    await flush();
    expect(unlisten).toHaveBeenCalledTimes(1);
    read.resolve(1);
    await flush();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a feed stopped mid-read drops the reply and stops listening", async () => {
    const read = deferred<number>();
    const apply = vi.fn();
    const feed = startJournalFeed(() => read.promise, apply, vi.fn());
    listened.resolve(unlisten);
    await flush();
    feed.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
    read.resolve(1);
    await flush();
    expect(apply).not.toHaveBeenCalled();
  });

  describe("polling", () => {
    it("does not poll without an interval", async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(() => Promise.resolve(1));
      startJournalFeed(fetch, vi.fn(), vi.fn());
      listened.resolve(unlisten);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 3);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("re-reads every interval with no event at all", async () => {
      vi.useFakeTimers();
      let n = 0;
      const fetch = vi.fn(() => Promise.resolve(++n));
      const apply = vi.fn();
      startJournalFeed(fetch, apply, vi.fn(), FEED_POLL_MS);
      listened.resolve(unlisten);
      await flush();
      expect(apply.mock.calls).toEqual([[1]]);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS - 1);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      expect(apply.mock.calls).toEqual([[1], [2], [3]]);
    });

    it("an event read restarts the interval instead of adding a reader", async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(() => Promise.resolve(1));
      startJournalFeed(fetch, vi.fn(), vi.fn(), FEED_POLL_MS);
      listened.resolve(unlisten);
      await flush();
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS / 2);
      fire("2");
      await flush();
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS - 1);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("a failed read backs off as before, then polling resumes", async () => {
      vi.useFakeTimers();
      const fetch = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(5);
      startJournalFeed(fetch, vi.fn(), vi.fn(), FEED_POLL_MS);
      listened.resolve(unlisten);
      await flush();
      await vi.advanceTimersByTimeAsync(FEED_RETRY_MS);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("a stopped feed polls no more", async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(() => Promise.resolve(1));
      const feed = startJournalFeed(fetch, vi.fn(), vi.fn(), FEED_POLL_MS);
      listened.resolve(unlisten);
      await flush();
      feed.stop();
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 3);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("a feed stopped mid-read schedules no poll when the read lands", async () => {
      vi.useFakeTimers();
      const read = deferred<number>();
      const fetch = vi.fn(() => read.promise);
      const feed = startJournalFeed(fetch, vi.fn(), vi.fn(), FEED_POLL_MS);
      listened.resolve(unlisten);
      await flush();
      feed.stop();
      read.resolve(1);
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 3);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
