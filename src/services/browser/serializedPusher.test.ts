// @vitest-environment node
// Audit 2026-09-03 (round 1) — the driver mirrors (grants, AI policy) converge on the
// latest value, in order, and never abandon a failed tightening push.
import { describe, it, expect, vi } from "vitest";
import { makeSerializedPusher } from "./serializedPusher";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("makeSerializedPusher", () => {
  it("sends the latest value only, and never two at once", async () => {
    let inFlight = 0;
    const sent: number[] = [];
    let release: (() => void) | undefined;
    const send = vi.fn(async (v: number) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      await new Promise<void>((r) => {
        release = r;
      });
      inFlight -= 1;
      sent.push(v);
    });
    const pusher = makeSerializedPusher(send, () => {});
    pusher.push(1);
    pusher.push(2);
    pusher.push(3); // 2 is superseded before it is ever sent
    await flush();
    release?.();
    await flush();
    release?.();
    await flush();
    expect(sent).toEqual([1, 3]);
    expect(pusher.isConverged()).toBe(true);
  });

  it("retries a failed push with backoff until it succeeds — a revocation is not abandoned", async () => {
    const send = vi
      .fn<(v: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("driver down"))
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValue(undefined);
    const failures: number[] = [];
    const sleeps: number[] = [];
    const pusher = makeSerializedPusher(send, (_e, attempt) => failures.push(attempt), async (ms) => {
      sleeps.push(ms);
    });
    pusher.push("revoke");
    await flush();
    await flush();
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(failures).toEqual([1, 2]);
    expect(sleeps).toEqual([100, 200]);
    expect(pusher.isConverged()).toBe(true);
  });

  it("stops after dispose: no further sends, and a failure is not retried", async () => {
    const send = vi.fn<(v: string) => Promise<void>>().mockRejectedValue(new Error("down"));
    const pusher = makeSerializedPusher(send, () => {}, async () => {});
    pusher.push("a");
    pusher.dispose();
    await flush();
    await flush();
    pusher.push("b");
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
