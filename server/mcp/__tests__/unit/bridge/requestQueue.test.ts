/**
 * Audit 20260906, MCP-M01 — a reconnect flush stripped the deadline from
 * every queued request, including those it had not sent yet.
 *
 * `flush()` detaches the whole queue before the first send, and the timeout
 * callback used to look for its entry IN that queue. So the instant a flush
 * began, every entry looked "already in flight" and lost its deadline — while
 * in truth the sends are SERIAL and only the first was in flight. A follower
 * could then sit behind many request timeouts with no deadline of its own.
 *
 * Reachability: `queueWhileDisconnected` defaults false and the bundled CLI
 * does not set it, so this is an exported-library defect, not a shipped
 * sidecar failure. Fixed and pinned anyway — the option is documented and
 * public.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OutboundRequestQueue } from "../../../src/bridge/requestQueue.js";
import type { BridgeRequest, BridgeResponse } from "../../../src/bridge/types.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * A distinct request object. `BridgeRequest` is a generated union keyed by
 * `type` with no id field, so requests are told apart by IDENTITY here — the
 * same shape `websocket.test.ts` uses.
 */
function req(): BridgeRequest {
  return { type: "vmark.document.save" } as unknown as BridgeRequest;
}
function ok(label: string): BridgeResponse {
  return { success: true, data: { label } } as unknown as BridgeResponse;
}

/**
 * Observe a promise's rejection RIGHT NOW, resolving to the error (or null).
 *
 * A rejection that is only awaited later is unhandled in the meantime, and
 * vitest fails the run on an unhandled rejection.
 */
function settle(promise: Promise<unknown>): Promise<Error | null> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
}

/** A promise plus its resolve handle. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("OutboundRequestQueue deadlines during a flush", () => {
  it("times out a follower that is still waiting its turn", async () => {
    const queue = new OutboundRequestQueue(10, 1000, logger);
    const a = req();
    const b = req();
    const first = queue.enqueue(a);
    // Observed IMMEDIATELY: the rejection lands inside the timer advance
    // below, and a rejection that is only awaited afterwards is an unhandled
    // rejection in between — which vitest reports as an unhandled error.
    const second = settle(queue.enqueue(b));

    // Hold the first send open so `b` never gets dispatched.
    const gate = deferred<BridgeResponse>();
    const flushing = queue.flush(async (r) => (r === a ? gate.promise : ok("b")));

    // The defect: this used to pass unnoticed because `b` had no deadline.
    await vi.advanceTimersByTimeAsync(1500);
    expect((await second)?.message).toMatch(/timed out/);

    gate.resolve(ok("a"));
    await flushing;
    await expect(first).resolves.toEqual(ok("a"));
  });

  // The other half of the contract (#959): the entry actually in flight must
  // NOT be timed out by the queue — its own send governs the wait.
  it("does not time out the request that is in flight", async () => {
    const queue = new OutboundRequestQueue(10, 1000, logger);
    const only = queue.enqueue(req());

    const gate = deferred<BridgeResponse>();
    const flushing = queue.flush(async () => gate.promise);

    await vi.advanceTimersByTimeAsync(5000);
    gate.resolve(ok("a"));
    await flushing;

    await expect(only).resolves.toEqual(ok("a"));
  });

  it("does not send a follower whose deadline already expired", async () => {
    const queue = new OutboundRequestQueue(10, 1000, logger);
    const a = req();
    const b = req();
    queue.enqueue(a);
    const second = settle(queue.enqueue(b));

    const sent: BridgeRequest[] = [];
    const gate = deferred<BridgeResponse>();
    const flushing = queue.flush(async (r) => {
      sent.push(r);
      return r === a ? gate.promise : ok("b");
    });

    await vi.advanceTimersByTimeAsync(1500);
    gate.resolve(ok("a"));
    await flushing;

    expect(sent).toEqual([a]);
    expect((await second)?.message).toMatch(/timed out/);
  });

  it("still flushes every request when nothing is slow", async () => {
    const queue = new OutboundRequestQueue(10, 1000, logger);
    const sent: BridgeRequest[] = [];
    const first = req();
    const second = req();
    const third = req();
    const a = queue.enqueue(first);
    const b = queue.enqueue(second);
    const c = queue.enqueue(third);

    await queue.flush(async (r) => {
      sent.push(r);
      return ok("done");
    });

    expect(sent).toEqual([first, second, third]);
    await expect(a).resolves.toEqual(ok("done"));
    await expect(b).resolves.toEqual(ok("done"));
    await expect(c).resolves.toEqual(ok("done"));
  });

  it("times out an entry that is never flushed at all", async () => {
    const queue = new OutboundRequestQueue(10, 1000, logger);
    const pending = settle(queue.enqueue(req()));

    await vi.advanceTimersByTimeAsync(1500);

    expect((await pending)?.message).toMatch(/timed out/);
  });

  it("settles each request exactly once", async () => {
    const queue = new OutboundRequestQueue(10, 1000, logger);
    const a = queue.enqueue(req());
    const settled: string[] = [];
    a.then(() => settled.push("resolved")).catch(() => settled.push("rejected"));

    await queue.flush(async () => ok("done"));
    await vi.advanceTimersByTimeAsync(5000);

    expect(settled).toEqual(["resolved"]);
  });

  it("propagates a send failure to its own request only", async () => {
    const queue = new OutboundRequestQueue(10, 10_000, logger);
    const failing = req();
    const a = queue.enqueue(failing);
    const b = queue.enqueue(req());

    await queue.flush(async (r) => {
      if (r === failing) throw new Error("socket closed");
      return ok("b");
    });

    await expect(a).rejects.toThrow("socket closed");
    await expect(b).resolves.toEqual(ok("b"));
  });
});
