// WI-4.2 / R8a — write-safety decision core (never double-post a partial write)
import { describe, it, expect } from "vitest";
import {
  decideAfterResult,
  nextTier,
  idempotencyKey,
  loopStopReason,
  TIER_ORDER,
} from "./safety";

describe("decideAfterResult (R8a)", () => {
  it("a success is done — never retried", () => {
    expect(decideAfterResult(false, { outcome: "success" })).toBe("done");
    expect(decideAfterResult(true, { outcome: "success" })).toBe("done");
  });

  it("an UNKNOWN outcome always stops and asks — never auto-retries", () => {
    // This is the core R8a rule: a retry could double-apply a partial write.
    expect(decideAfterResult(true, { outcome: "unknown" })).toBe("stop-and-ask");
    expect(decideAfterResult(false, { outcome: "unknown" })).toBe("stop-and-ask");
    expect(decideAfterResult(true, { outcome: "unknown", postconditionMet: false })).toBe(
      "stop-and-ask",
    );
  });

  it("a failed READ retries (reads are idempotent)", () => {
    expect(decideAfterResult(false, { outcome: "failed" })).toBe("retry");
  });

  it("a failed WRITE consults the postcondition before retrying", () => {
    // Confirmed not applied → safe to retry.
    expect(decideAfterResult(true, { outcome: "failed", postconditionMet: false })).toBe("retry");
    // Actually landed despite the error → idempotent success, done.
    expect(decideAfterResult(true, { outcome: "failed", postconditionMet: true })).toBe("done");
    // Inconclusive postcondition → never risk a double write.
    expect(decideAfterResult(true, { outcome: "failed" })).toBe("stop-and-ask");
  });
});

describe("nextTier (R8a: writes never auto-escalate)", () => {
  it("escalates a read through the tier order", () => {
    expect(nextTier("api", false)).toBe("action");
    expect(nextTier("action", false)).toBe("goal");
    expect(nextTier("goal", false)).toBe("vision");
    expect(nextTier("vision", false)).toBeNull(); // top of the ladder
  });

  it("never auto-escalates a write", () => {
    expect(nextTier("api", true)).toBeNull();
    expect(nextTier("action", true)).toBeNull();
  });

  it("exposes the canonical tier order", () => {
    expect(TIER_ORDER).toEqual(["api", "action", "goal", "vision"]);
  });
});

describe("idempotencyKey", () => {
  it("is deterministic and order-independent in the inputs", () => {
    const a = idempotencyKey("publish", { title: "Hi", draft: true });
    const b = idempotencyKey("publish", { draft: true, title: "Hi" });
    expect(a).toBe(b);
  });

  it("differs when the step or inputs differ", () => {
    expect(idempotencyKey("publish", { title: "Hi" })).not.toBe(
      idempotencyKey("publish", { title: "Bye" }),
    );
    expect(idempotencyKey("publish", { title: "Hi" })).not.toBe(
      idempotencyKey("update", { title: "Hi" }),
    );
  });

  it("handles nested inputs deterministically", () => {
    const a = idempotencyKey("s", { a: { x: 1, y: 2 }, b: [3, 4] });
    const b = idempotencyKey("s", { b: [3, 4], a: { y: 2, x: 1 } });
    expect(a).toBe(b);
  });
});

describe("loopStopReason (genie-loop bounds)", () => {
  const bounds = { maxIterations: 5, timeoutMs: 10_000 };

  it("continues when under all bounds", () => {
    expect(loopStopReason({ iterations: 2, elapsedMs: 1000, cancelled: false }, bounds)).toBeNull();
  });

  it("cancellation wins over everything", () => {
    expect(
      loopStopReason({ iterations: 99, elapsedMs: 99_999, cancelled: true }, bounds),
    ).toBe("cancelled");
  });

  it("stops at the iteration cap", () => {
    expect(loopStopReason({ iterations: 5, elapsedMs: 0, cancelled: false }, bounds)).toBe(
      "max-iterations",
    );
  });

  it("stops at the timeout", () => {
    expect(loopStopReason({ iterations: 0, elapsedMs: 10_000, cancelled: false }, bounds)).toBe(
      "timeout",
    );
  });
});
