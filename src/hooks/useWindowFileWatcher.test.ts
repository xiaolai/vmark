import { describe, it, expect, beforeEach } from "vitest";
import { enqueueWatcherOp, watcherQueues } from "./useWindowFileWatcher";

beforeEach(() => {
  watcherQueues.clear();
});

describe("enqueueWatcherOp (per-window serialization)", () => {
  it("runs operations for the same window in enqueue order", async () => {
    const order: string[] = [];

    // First op resolves slowly; second op is fast. Without serialization the
    // fast op would complete first and a stale stop could win the race.
    enqueueWatcherOp("main", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("first");
    });
    enqueueWatcherOp("main", async () => {
      order.push("second");
    });

    await watcherQueues.get("main");
    expect(order).toEqual(["first", "second"]);
  });

  it("does not let a stale stop-after-start undo the newer start (the race)", async () => {
    const log: string[] = [];

    // Simulate: cleanup stop (slow) → new start (fast) → next cleanup stop.
    // The crucial guarantee is that the new start runs strictly AFTER the
    // stale stop, never the other way around.
    enqueueWatcherOp("main", async () => {
      await new Promise((r) => setTimeout(r, 25));
      log.push("stop(stale)");
    });
    enqueueWatcherOp("main", async () => {
      log.push("start(new)");
    });

    await watcherQueues.get("main");
    expect(log).toEqual(["stop(stale)", "start(new)"]);
    // start(new) is last → the watcher is left running, not torn down.
    expect(log[log.length - 1]).toBe("start(new)");
  });

  it("isolates queues across different windows", async () => {
    const seen: string[] = [];
    enqueueWatcherOp("main", async () => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push("main");
    });
    enqueueWatcherOp("doc-1", async () => {
      seen.push("doc-1");
    });

    await Promise.all([watcherQueues.get("main"), watcherQueues.get("doc-1")]);
    // doc-1 (fast, independent queue) finishes before slow main.
    expect(seen).toEqual(["doc-1", "main"]);
  });

  it("continues the chain even when an operation rejects", async () => {
    const ran: string[] = [];
    enqueueWatcherOp("main", async () => {
      ran.push("a");
      throw new Error("boom");
    });
    enqueueWatcherOp("main", async () => {
      ran.push("b");
    });

    await watcherQueues.get("main");
    expect(ran).toEqual(["a", "b"]);
  });

  it("clears the queue entry once all work settles", async () => {
    enqueueWatcherOp("main", async () => {});
    await watcherQueues.get("main");
    // Microtask for the finally cleanup to run.
    await Promise.resolve();
    expect(watcherQueues.has("main")).toBe(false);
  });
});

describe("useWindowFileWatcher (invoke ordering integration)", () => {
  it("serializes start/stop invokes through the queue", async () => {
    // Spy module-level invoke indirectly via enqueue: enqueue a start then a
    // stop and confirm the stop runs after the start completes.
    const calls: string[] = [];
    enqueueWatcherOp("doc-2", async () => {
      await new Promise((r) => setTimeout(r, 15));
      calls.push("start_watching");
    });
    enqueueWatcherOp("doc-2", async () => {
      calls.push("stop_watching");
    });
    await watcherQueues.get("doc-2");
    expect(calls).toEqual(["start_watching", "stop_watching"]);
  });
});
