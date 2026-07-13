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

  it("stops on a CONTRADICTORY write result (reported success, postcondition says not applied)", () => {
    // Two signals disagree about whether the write landed. Trusting the success
    // report marks a never-applied publish complete; trusting the postcondition and
    // retrying could double-post. Neither is safe — a human decides.
    expect(decideAfterResult(true, { outcome: "success", postconditionMet: false })).toBe(
      "stop-and-ask",
    );
    // A confirming postcondition is not a contradiction.
    expect(decideAfterResult(true, { outcome: "success", postconditionMet: true })).toBe("done");
    // A read has no write to postcondition — a success is a success.
    expect(decideAfterResult(false, { outcome: "success", postconditionMet: false })).toBe("done");
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

  // A key COLLISION between two different writes is exactly the double-post this
  // module exists to prevent — JSON.stringify collapses several distinct values.
  it("never collides distinct values that JSON.stringify would flatten", () => {
    const key = (v: unknown) => idempotencyKey("s", { v });
    const distinct = [
      key(NaN),
      key(null),
      key(undefined),
      key("null"),
      key(Infinity),
      key(-Infinity),
      key([undefined]),
      key([]),
      key([null]),
      key(0),
      key("0"),
      key(false),
    ];
    expect(new Set(distinct).size).toBe(distinct.length);
    // `{a: undefined}` is not `{}`.
    expect(idempotencyKey("s", { a: undefined })).not.toBe(idempotencyKey("s", {}));
  });

  it("encodes dates and bigints instead of collapsing or throwing", () => {
    const d1 = idempotencyKey("s", { at: new Date("2026-01-01T00:00:00Z") });
    const d2 = idempotencyKey("s", { at: new Date("2026-01-02T00:00:00Z") });
    expect(d1).not.toBe(d2);
    expect(idempotencyKey("s", { n: 1n })).not.toBe(idempotencyKey("s", { n: 2n }));
    expect(idempotencyKey("s", { n: 1n })).not.toBe(idempotencyKey("s", { n: 1 }));
  });

  it("throws on a cyclic input rather than recursing forever", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => idempotencyKey("s", cyclic)).toThrow(TypeError);
  });

  it("throws on values it cannot encode unambiguously", () => {
    expect(() => idempotencyKey("s", { f: () => 1 })).toThrow(TypeError);
    expect(() => idempotencyKey("s", { s: Symbol("x") })).toThrow(TypeError);
    // A Map/Set would silently flatten to `{}` — two different maps must not share a key.
    expect(() => idempotencyKey("s", { m: new Map([["a", 1]]) })).toThrow(TypeError);
    expect(() => idempotencyKey("s", { s: new Set([1]) })).toThrow(TypeError);
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
