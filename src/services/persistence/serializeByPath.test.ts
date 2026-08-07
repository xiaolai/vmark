// @vitest-environment node
/**
 * Ordering guarantees for concurrent writes to one path.
 *
 * The defect this exists for: `saveToPath` had no serialization, so two saves
 * to one file raced. If the OLDER write's `atomic_write_file` completed second
 * — entirely possible under load, and the whole point of a debounced autosave
 * plus a manual save landing together — the older content won on disk AND
 * `applyPostSaveState` then recorded it as the saved snapshot, so the document
 * showed clean against bytes the user never asked for.
 *
 * @coordinates-with services/persistence/serializeByPath.ts
 * @module services/persistence/serializeByPath.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  serializeByPath,
  pendingPathCount,
  __resetSerializer,
} from "./serializeByPath";

beforeEach(() => __resetSerializer());

/** A promise plus its resolve/reject handles. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ordering on one path", () => {
  it("runs tasks in submission order even when the first finishes last", async () => {
    // The exact reversal: task A's work takes longer than task B's, so without
    // serialization B lands first and A overwrites it.
    const order: string[] = [];
    const slow = deferred();

    const a = serializeByPath("/f.md", async () => {
      await slow.promise;
      order.push("A");
      return "A";
    });
    const b = serializeByPath("/f.md", async () => {
      order.push("B");
      return "B";
    });

    slow.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(["A", "B"]);
  });

  it("does not start the second task until the first has settled", async () => {
    const gate = deferred();
    let secondStarted = false;

    const first = serializeByPath("/f.md", () => gate.promise);
    void serializeByPath("/f.md", async () => {
      secondStarted = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    gate.resolve();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(true);
  });

  it("preserves order across many submissions", async () => {
    const order: number[] = [];
    const tasks = Array.from({ length: 20 }, (_, i) =>
      serializeByPath("/f.md", async () => {
        // Random-ish settle delay via microtask depth, reversed by index.
        for (let n = 0; n < 20 - i; n += 1) await Promise.resolve();
        order.push(i);
      })
    );
    await Promise.all(tasks);
    expect(order).toEqual([...Array(20).keys()]);
  });
});

describe("independence across paths", () => {
  it("does not serialize different paths against each other", async () => {
    const gate = deferred();
    let otherFinished = false;

    const blocked = serializeByPath("/a.md", () => gate.promise);
    await serializeByPath("/b.md", async () => {
      otherFinished = true;
    });

    expect(otherFinished).toBe(true); // did not wait on /a.md
    gate.resolve();
    await blocked;
  });
});

describe("failure handling", () => {
  it("propagates the task's rejection to its own caller", async () => {
    await expect(
      serializeByPath("/f.md", async () => {
        throw new Error("write failed");
      })
    ).rejects.toThrow("write failed");
  });

  it("a failed task does not wedge the path — the next one still runs", async () => {
    // A save that throws must not make the file unsaveable for the session.
    await expect(
      serializeByPath("/f.md", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow();

    await expect(
      serializeByPath("/f.md", async () => "recovered")
    ).resolves.toBe("recovered");
  });

  it("a rejection inside the chain never becomes an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    globalThis.addEventListener?.("unhandledrejection", onUnhandled);

    // Caller deliberately ignores the failure — the chain must still be clean.
    void serializeByPath("/f.md", async () => {
      throw new Error("ignored");
    }).catch(() => {});
    await serializeByPath("/f.md", async () => "next");

    globalThis.removeEventListener?.("unhandledrejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

describe("the map does not leak", () => {
  it("prunes a path once its work settles", async () => {
    await serializeByPath("/f.md", async () => "done");
    await Promise.resolve();
    await Promise.resolve();
    expect(pendingPathCount()).toBe(0);
  });

  it("prunes after a failure too", async () => {
    await serializeByPath("/f.md", async () => {
      throw new Error("x");
    }).catch(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(pendingPathCount()).toBe(0);
  });

  it("keeps the entry while a successor is still queued", async () => {
    const gate = deferred();
    const first = serializeByPath("/f.md", () => gate.promise);
    const second = serializeByPath("/f.md", async () => "second");

    expect(pendingPathCount()).toBe(1);
    gate.resolve();
    await Promise.all([first, second]);
    await Promise.resolve();
    await Promise.resolve();
    expect(pendingPathCount()).toBe(0);
  });

  it("does not prune an entry a later submission already replaced", async () => {
    const gate = deferred();
    await serializeByPath("/f.md", async () => "first");
    const queued = serializeByPath("/f.md", () => gate.promise);

    await Promise.resolve();
    expect(pendingPathCount()).toBe(1); // the first's pruning must not remove this

    gate.resolve();
    await queued;
  });
});
