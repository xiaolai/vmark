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
    expect(res.reason).toMatch(/lease/i);
    expect(exec).not.toHaveBeenCalled();
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
