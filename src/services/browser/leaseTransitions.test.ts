// @vitest-environment node
// Audit 2026-09-03 round 3 (#92) — the pure lease transitions and canceller-map
// operations the lease store composes. Invariants: every operation returns a new
// record and never mutates its input; the epoch moves by exactly one on an authority
// transition and by zero on anything else; other tabs are never touched.
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_LEASE,
  detachCanceller,
  grantToAi,
  invalidateLease,
  leaseOf,
  validateEnvelope,
  withCanceller,
  withoutTab,
  type Cancellers,
  type Leases,
} from "./leaseTransitions";

const TAB = "tab-1";
const OTHER = "tab-2";
const frozen = <T extends object>(value: T): T => Object.freeze(value);

describe("leaseOf", () => {
  it("returns the empty lease for an unknown tab and the record for a known one", () => {
    expect(leaseOf({}, TAB)).toEqual(EMPTY_LEASE);
    expect(leaseOf({ [TAB]: { holder: "ai", epoch: 2 } }, TAB)).toEqual({ holder: "ai", epoch: 2 });
  });
});

describe("grantToAi", () => {
  it("grants a free tab to the AI at the same epoch", () => {
    const leases = frozen<Leases>({});
    expect(grantToAi(leases, TAB)).toEqual({ [TAB]: { holder: "ai", epoch: 0 } });
  });

  it("keeps a re-grant idempotent: the epoch does not move", () => {
    const leases = frozen<Leases>({ [TAB]: frozen({ holder: "ai", epoch: 4 }) });
    expect(grantToAi(leases, TAB)).toEqual({ [TAB]: { holder: "ai", epoch: 4 } });
  });

  it("refuses while the human holds the tab, returning null and leaving the record alone", () => {
    const leases = frozen<Leases>({ [TAB]: frozen({ holder: "human", epoch: 1 }) });
    expect(grantToAi(leases, TAB)).toBeNull();
    expect(leases[TAB]).toEqual({ holder: "human", epoch: 1 });
  });

  it("does not touch other tabs", () => {
    const other = frozen({ holder: "human" as const, epoch: 9 });
    const next = grantToAi(frozen<Leases>({ [OTHER]: other }), TAB);
    expect(next?.[OTHER]).toBe(other);
  });
});

describe("invalidateLease", () => {
  it("bumps the epoch by exactly one and installs the new holder", () => {
    const leases = frozen<Leases>({ [TAB]: frozen({ holder: "ai", epoch: 3 }) });
    expect(invalidateLease(leases, TAB, "human")).toEqual({ [TAB]: { holder: "human", epoch: 4 } });
    expect(invalidateLease(leases, TAB, null)).toEqual({ [TAB]: { holder: null, epoch: 4 } });
  });

  it("starts an unknown tab from the empty lease (epoch 0 → 1)", () => {
    expect(invalidateLease({}, TAB, null)).toEqual({ [TAB]: { holder: null, epoch: 1 } });
  });

  it("moves the epoch on every call — there is no idempotence for an authority transition", () => {
    let leases: Leases = {};
    for (let i = 1; i <= 5; i++) {
      leases = invalidateLease(leases, TAB, i % 2 ? "human" : null);
      expect(leaseOf(leases, TAB).epoch).toBe(i);
    }
  });

  it("leaves other tabs' records untouched (same reference)", () => {
    const other = frozen({ holder: "ai" as const, epoch: 2 });
    const next = invalidateLease(frozen<Leases>({ [OTHER]: other, [TAB]: frozen({ holder: "ai", epoch: 0 }) }), TAB, "human");
    expect(next[OTHER]).toBe(other);
  });
});

describe("validateEnvelope", () => {
  const leases: Leases = { [TAB]: { holder: "ai", epoch: 2 } };
  it.each([
    ["the holder and epoch match", TAB, "ai", 2, "ok"],
    ["the holder changed", TAB, "human", 2, "lease-lost"],
    ["the epoch moved", TAB, "ai", 1, "stale"],
    ["the epoch is ahead (an envelope from the future is not current either)", TAB, "ai", 3, "stale"],
    ["the tab is unknown", OTHER, "ai", 0, "lease-lost"],
  ] as const)("%s → %s", (_label, tabId, holder, epoch, expected) => {
    expect(validateEnvelope(leases, tabId, holder, epoch)).toBe(expected);
  });

  it("a free tab is lease-lost for every holder", () => {
    const free: Leases = { [TAB]: { holder: null, epoch: 1 } };
    expect(validateEnvelope(free, TAB, "ai", 1)).toBe("lease-lost");
    expect(validateEnvelope(free, TAB, "human", 1)).toBe("lease-lost");
  });
});

describe("withoutTab", () => {
  it("removes exactly that key and keeps the other values by reference", () => {
    const keep = frozen({ holder: "ai" as const, epoch: 1 });
    const next = withoutTab(frozen<Leases>({ [TAB]: frozen({ holder: null, epoch: 5 }), [OTHER]: keep }), TAB);
    expect(Object.keys(next)).toEqual([OTHER]);
    expect(next[OTHER]).toBe(keep);
  });

  it("is a structural no-op for an unknown key", () => {
    expect(withoutTab<number>({ a: 1 }, "b")).toEqual({ a: 1 });
  });
});

describe("detachCanceller", () => {
  it("returns the canceller and a map without it", () => {
    const cancel = vi.fn();
    const keep = vi.fn();
    const { cancellers, cancel: detached } = detachCanceller(frozen<Cancellers>({ [TAB]: cancel, [OTHER]: keep }), TAB);
    expect(detached).toBe(cancel);
    expect(cancellers).toEqual({ [OTHER]: keep });
    expect(cancel).not.toHaveBeenCalled(); // detaching never fires it
  });

  it("returns undefined and the same map when there is nothing to detach", () => {
    const input = frozen<Cancellers>({ [OTHER]: vi.fn() });
    const { cancellers, cancel } = detachCanceller(input, TAB);
    expect(cancel).toBeUndefined();
    expect(cancellers).toBe(input);
  });

  it("detaching twice yields nothing the second time — a canceller fires at most once", () => {
    const first = detachCanceller({ [TAB]: vi.fn() }, TAB);
    expect(detachCanceller(first.cancellers, TAB).cancel).toBeUndefined();
  });
});

describe("withCanceller", () => {
  it("installs a canceller, replaces one, and clears one with null", () => {
    const a = vi.fn();
    const b = vi.fn();
    const withA = withCanceller(frozen<Cancellers>({}), TAB, a);
    expect(withA[TAB]).toBe(a);
    const withB = withCanceller(frozen(withA), TAB, b);
    expect(withB[TAB]).toBe(b);
    const cleared = withCanceller(frozen(withB), TAB, null);
    expect(Object.hasOwn(cleared, TAB)).toBe(false);
  });

  it("leaves other tabs by reference", () => {
    const other = vi.fn();
    const next = withCanceller(frozen<Cancellers>({ [OTHER]: other }), TAB, vi.fn());
    expect(next[OTHER]).toBe(other);
  });
});
