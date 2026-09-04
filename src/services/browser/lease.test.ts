// @vitest-environment node
// WI-1.9 / R11 / WI-NB5.1 — automation lease: AI vs human arbitration.
// The epoch is the TAKEOVER clock: it moves only when authority changes
// (reclaim, release) — never on navigation, so a workflow's own navigate
// steps cannot self-cancel the run (Codex review C3). Per-page staleness
// is the driver's navigation-generation check, a different clock.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBrowserLeaseStore } from "./lease";

const TAB = "browser-1";

function reset() {
  useBrowserLeaseStore.setState({ leases: {}, inflightCancel: {} });
}

beforeEach(reset);

describe("acquireForAi", () => {
  it("grants the lease on a free tab (holder=ai, epoch starts at 0)", () => {
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(true);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(0);
  });

  it("is idempotent when the AI already holds the lease", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(true);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
  });

  it("refuses while a human hold is fresh (human always wins over the interrupted run)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(false);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
  });

  // Audit 2026-09-03 W-04: a human hold used to be PERMANENT — nothing released it,
  // so one accidental scroll refused every later workflow_run on the tab until it
  // was closed. The hold is the interruption of an AI tenure; the run service
  // releases it when the interrupted run ends, and the AI may acquire again.
  it("succeeds again once the human hold is released (a hold is not permanent)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    useBrowserLeaseStore.getState().release(TAB, "human");
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(true);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
  });
});

describe("reclaimForHuman", () => {
  it("always takes the lease, bumps the epoch, and cancels the AI's in-flight step", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const cancel = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, cancel);
    const genBefore = useBrowserLeaseStore.getState().epochOf(TAB);

    useBrowserLeaseStore.getState().reclaimForHuman(TAB);

    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(genBefore + 1);
    expect(cancel).toHaveBeenCalledTimes(1);
    // The canceller is cleared after firing (no double-cancel on a later reclaim).
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on a tab the AI does not hold — ordinary browsing never creates a human hold (W-04)", () => {
    expect(() => useBrowserLeaseStore.getState().reclaimForHuman(TAB)).not.toThrow();
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(0);
    // …so a later run is not locked out by a scroll that interrupted nothing.
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(true);
  });

  it("is a no-op while the human already holds it (no double bump, no double cancel)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    const epoch = useBrowserLeaseStore.getState().epochOf(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(epoch);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
  });
});

describe("validate (driver command envelope)", () => {
  it("accepts an AI command tagged with the current holder and generation", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const gen = useBrowserLeaseStore.getState().epochOf(TAB);
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", gen)).toBe("ok");
  });

  it("rejects an AI command as lease-lost after a human reclaim", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const staleGen = useBrowserLeaseStore.getState().epochOf(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    // Lease holder is now human → an "ai"-tagged command is lease-lost, not stale.
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", staleGen)).toBe("lease-lost");
  });

  it("rejects an AI command as stale after a reclaim/release cycle moved the epoch", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const oldGen = useBrowserLeaseStore.getState().epochOf(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    useBrowserLeaseStore.getState().release(TAB, "human");
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", oldGen)).toBe("stale");
    // A command tagged with the CURRENT epoch is accepted again.
    const newEpoch = useBrowserLeaseStore.getState().epochOf(TAB);
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", newEpoch)).toBe("ok");
  });

  it("treats a command for an unknown tab as lease-lost", () => {
    expect(useBrowserLeaseStore.getState().validate("nope", "ai", 0)).toBe("lease-lost");
  });
});

describe("epoch semantics (WI-NB5.1)", () => {
  it("release bumps the epoch, so a pre-release envelope cannot validate after re-acquire", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const epoch = useBrowserLeaseStore.getState().epochOf(TAB);
    useBrowserLeaseStore.getState().release(TAB, "ai");
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", epoch)).toBe("stale");
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", useBrowserLeaseStore.getState().epochOf(TAB))).toBe("ok");
  });

  it("reclaim-then-release-then-reacquire never resurrects an old envelope", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const epoch = useBrowserLeaseStore.getState().epochOf(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    useBrowserLeaseStore.getState().release(TAB, "human");
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", epoch)).toBe("stale");
  });

  it("there is no navigation clock here: nothing but authority transitions moves the epoch", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const epoch = useBrowserLeaseStore.getState().epochOf(TAB);
    // Simulated long tenure: acquire is idempotent and moves nothing.
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(epoch);
    expect((useBrowserLeaseStore.getState() as unknown as Record<string, unknown>).bumpGeneration).toBeUndefined();
  });
});

describe("release", () => {
  it("releases the lease held by the given holder", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().release(TAB, "ai");
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("is a no-op when released by a non-holder (does not steal the lease)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    useBrowserLeaseStore.getState().release(TAB, "ai");
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
  });
});

describe("removeTab", () => {
  it("clears lease + inflight state for a closed tab", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().setInflightCancel(TAB, vi.fn());
    useBrowserLeaseStore.getState().removeTab(TAB);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(0);
  });

  it("cancels the AI's in-flight step (never leave it running against a destroyed surface)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const cancel = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, cancel);
    useBrowserLeaseStore.getState().removeTab(TAB);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("in-flight canceller lifecycle", () => {
  it("release cancels and clears the in-flight step (no lease → no in-flight AI step)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const cancel = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, cancel);
    useBrowserLeaseStore.getState().release(TAB, "ai");
    expect(cancel).toHaveBeenCalledTimes(1);
    // Cleared: a later reclaim must not re-fire the same canceller.
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("a refused release leaves the in-flight step alone", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB); // human holds
    const cancel = vi.fn();
    useBrowserLeaseStore.setState({ inflightCancel: { [TAB]: cancel } });
    useBrowserLeaseStore.getState().release(TAB, "ai"); // not the holder → no-op
    expect(cancel).not.toHaveBeenCalled();
  });

  it("refuses to register a canceller while the AI does not hold the lease, cancelling it at once", () => {
    // A registration that lands after a human reclaim would otherwise re-install
    // an operation the reclaim just cancelled (R11).
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    const late = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, late);
    expect(late).toHaveBeenCalledTimes(1); // rejected → cancelled immediately
    expect(useBrowserLeaseStore.getState().inflightCancel[TAB]).toBeUndefined();
  });

  it("replacing a canceller cancels the previous in-flight step (at most one per tab)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const first = vi.fn();
    const second = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, first);
    useBrowserLeaseStore.getState().setInflightCancel(TAB, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("clearing the canceller (null) does not fire it — the step completed on its own", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const cancel = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, cancel);
    useBrowserLeaseStore.getState().setInflightCancel(TAB, null);
    expect(cancel).not.toHaveBeenCalled();
    expect(useBrowserLeaseStore.getState().inflightCancel[TAB]).toBeUndefined();
  });
});

describe("a misbehaving canceller cannot block a lease transition", () => {
  it("human reclaim still lands when the canceller throws", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().setInflightCancel(TAB, () => {
      throw new Error("cancel exploded");
    });

    expect(() => useBrowserLeaseStore.getState().reclaimForHuman(TAB)).not.toThrow();
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(1);
    expect(useBrowserLeaseStore.getState().inflightCancel[TAB]).toBeUndefined();
  });

  it("a reclaim still lands (and bumps the epoch) when the canceller throws", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().setInflightCancel(TAB, () => {
      throw new Error("cancel exploded");
    });

    expect(() => useBrowserLeaseStore.getState().reclaimForHuman(TAB)).not.toThrow();
    expect(useBrowserLeaseStore.getState().epochOf(TAB)).toBe(1);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
  });

  it("a re-entrant canceller cannot resurrect the AI's lease or its in-flight step", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const reregistered = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, () => {
      // The canceller re-enters the store: it must observe the COMMITTED
      // transition (human holds the lease), not overwrite it.
      useBrowserLeaseStore.getState().acquireForAi(TAB);
      useBrowserLeaseStore.getState().setInflightCancel(TAB, reregistered);
    });

    useBrowserLeaseStore.getState().reclaimForHuman(TAB);

    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
    expect(useBrowserLeaseStore.getState().inflightCancel[TAB]).toBeUndefined();
    expect(reregistered).toHaveBeenCalledTimes(1); // rejected → cancelled at once
  });
});
