// WI-4.2 / R8a — workflow execution engine: tiers, retry, write-safety, lease
import { describe, it, expect, vi } from "vitest";
import { runWorkflow, type EngineStep } from "./engine";

const read = (id: string): EngineStep => ({ id, write: false });
const write = (id: string): EngineStep => ({ id, write: true });

describe("runWorkflow", () => {
  it("completes when every step succeeds", async () => {
    const exec = vi.fn().mockResolvedValue({ outcome: "success" });
    const res = await runWorkflow([read("a"), write("b")], exec);
    expect(res.status).toBe("completed");
    expect(res.completedSteps).toBe(2);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("pauses on an UNKNOWN outcome — never barrels ahead (R8a)", async () => {
    const exec = vi.fn().mockResolvedValue({ outcome: "unknown" });
    const res = await runWorkflow([write("publish")], exec);
    expect(res.status).toBe("paused");
    expect(res.pausedAt).toBe("publish");
    expect(exec).toHaveBeenCalledTimes(1); // no retry
  });

  it("retries a failed READ and completes when it recovers", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "failed" })
      .mockResolvedValueOnce({ outcome: "success" });
    const res = await runWorkflow([read("a")], exec, { maxRetries: 2 });
    expect(res.status).toBe("completed");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("retries a failed WRITE only when its postcondition confirms it did not apply", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "failed", postconditionMet: false })
      .mockResolvedValueOnce({ outcome: "success" });
    const res = await runWorkflow([write("post")], exec, { maxRetries: 2 });
    expect(res.status).toBe("completed");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("pauses a failed WRITE with an inconclusive postcondition (never double-posts)", async () => {
    const exec = vi.fn().mockResolvedValue({ outcome: "failed" }); // postconditionMet undefined
    const res = await runWorkflow([write("post")], exec, { maxRetries: 2 });
    expect(res.status).toBe("paused");
    expect(res.pausedAt).toBe("post");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("treats a failed write whose postcondition shows it landed as an idempotent success", async () => {
    const exec = vi.fn().mockResolvedValue({ outcome: "failed", postconditionMet: true });
    const res = await runWorkflow([write("post")], exec);
    expect(res.status).toBe("completed");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("fails when a read keeps failing past maxRetries", async () => {
    const exec = vi.fn().mockResolvedValue({ outcome: "failed" });
    const res = await runWorkflow([read("a")], exec, { maxRetries: 2 });
    expect(res.status).toBe("failed");
    expect(res.pausedAt).toBe("a");
    // initial attempt + 2 retries = 3 executions
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it("pauses without acting when the automation lease is lost (R11)", async () => {
    const exec = vi.fn().mockResolvedValue({ outcome: "success" });
    const res = await runWorkflow([read("a"), write("b")], exec, {
      leaseHeld: () => false,
    });
    expect(res.status).toBe("paused");
    expect(res.reasonCode).toBe("lease-lost");
    expect(res.reason).toMatch(/lease/i);
    expect(exec).not.toHaveBeenCalled();
  });

  it("does NOT retry after the lease is lost mid-step (R11 — no acting on a page we lost)", async () => {
    let held = true;
    // The step fails retryably, but the lease is gone by the time the retry would run.
    const exec = vi.fn(async () => {
      held = false;
      return { outcome: "failed" } as const;
    });
    const res = await runWorkflow([read("a")], exec, { maxRetries: 3, leaseHeld: () => held });
    expect(res.status).toBe("paused");
    expect(res.reasonCode).toBe("lease-lost");
    expect(exec).toHaveBeenCalledTimes(1); // the retry never ran
  });

  it("runs steps in order and reports how many completed before pausing", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "success" })
      .mockResolvedValueOnce({ outcome: "unknown" });
    const res = await runWorkflow([read("a"), write("b"), read("c")], exec);
    expect(res.status).toBe("paused");
    expect(res.completedSteps).toBe(1); // "a" done, paused at "b"
    expect(res.pausedAt).toBe("b");
  });
});

describe("runWorkflow — executor failure", () => {
  it("converts a rejected executor into a paused result — the run state never escapes as a throw", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("driver crashed"));
    const res = await runWorkflow([write("publish")], exec, { maxRetries: 2 });
    expect(res.status).toBe("paused");
    expect(res.pausedAt).toBe("publish");
    expect(res.reasonCode).toBe("needs-human");
    expect(res.reason).toMatch(/driver crashed/);
    // A thrown executor leaves the effect UNKNOWN — which must never auto-retry (R8a).
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("keeps completed-step accounting when the executor rejects mid-run", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "success" })
      .mockRejectedValueOnce(new Error("boom"));
    const res = await runWorkflow([read("a"), write("b")], exec);
    expect(res).toMatchObject({ status: "paused", completedSteps: 1, pausedAt: "b" });
  });

  it("reports a non-Error rejection without throwing", async () => {
    const exec = vi.fn().mockRejectedValue("socket hang up");
    const res = await runWorkflow([read("a")], exec);
    expect(res.status).toBe("paused");
    expect(res.reason).toMatch(/socket hang up/);
  });
});

describe("runWorkflow — retry cap validation", () => {
  it.each([NaN, Infinity, -1, 1.5])(
    "rejects an invalid maxRetries (%s) instead of looping forever",
    async (maxRetries) => {
      const exec = vi.fn().mockResolvedValue({ outcome: "failed" });
      await expect(runWorkflow([read("a")], exec, { maxRetries })).rejects.toThrow(RangeError);
      expect(exec).not.toHaveBeenCalled();
    },
  );

  it("accepts maxRetries: 0 — one attempt, no retry", async () => {
    const exec = vi.fn().mockResolvedValue({ outcome: "failed" });
    const res = await runWorkflow([read("a")], exec, { maxRetries: 0 });
    expect(res.status).toBe("failed");
    expect(res.reasonCode).toBe("retries-exhausted");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe("runWorkflow — non-retryable steps (human gates)", () => {
  it("stops and asks instead of re-running a failed human gate", async () => {
    const gate: EngineStep = { id: "approve", write: false, retryable: false };
    const exec = vi.fn().mockResolvedValue({ outcome: "failed" });
    const res = await runWorkflow([gate], exec, { maxRetries: 3 });
    expect(res.status).toBe("paused");
    expect(res.pausedAt).toBe("approve");
    expect(res.reasonCode).toBe("needs-human");
    expect(exec).toHaveBeenCalledTimes(1); // never re-asked
  });

  it("still completes a human gate that succeeds", async () => {
    const gate: EngineStep = { id: "approve", write: false, retryable: false };
    const exec = vi.fn().mockResolvedValue({ outcome: "success" });
    const res = await runWorkflow([gate], exec);
    expect(res).toEqual({ status: "completed", completedSteps: 1 });
  });
});
