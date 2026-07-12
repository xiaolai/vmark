// WI-1.9 / R11 — automation lease: AI vs human arbitration
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBrowserLeaseStore } from "./lease";

const TAB = "browser-1";

function reset() {
  useBrowserLeaseStore.setState({ leases: {}, inflightCancel: {} });
}

beforeEach(reset);

describe("acquireForAi", () => {
  it("grants the lease on a free tab (holder=ai, generation starts at 0)", () => {
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(true);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
    expect(useBrowserLeaseStore.getState().generationOf(TAB)).toBe(0);
  });

  it("is idempotent when the AI already holds the lease", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(true);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
  });

  it("refuses when a human holds the lease (human always wins)", () => {
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    expect(useBrowserLeaseStore.getState().acquireForAi(TAB)).toBe(false);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
  });
});

describe("reclaimForHuman", () => {
  it("always takes the lease, bumps the generation, and cancels the AI's in-flight step", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const cancel = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, cancel);
    const genBefore = useBrowserLeaseStore.getState().generationOf(TAB);

    useBrowserLeaseStore.getState().reclaimForHuman(TAB);

    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
    expect(useBrowserLeaseStore.getState().generationOf(TAB)).toBe(genBefore + 1);
    expect(cancel).toHaveBeenCalledTimes(1);
    // The canceller is cleared after firing (no double-cancel on a later reclaim).
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("works on a tab with no prior lease", () => {
    expect(() => useBrowserLeaseStore.getState().reclaimForHuman(TAB)).not.toThrow();
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("human");
  });
});

describe("validate (driver command envelope)", () => {
  it("accepts an AI command tagged with the current holder and generation", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const gen = useBrowserLeaseStore.getState().generationOf(TAB);
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", gen)).toBe("ok");
  });

  it("rejects an AI command as lease-lost after a human reclaim", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const staleGen = useBrowserLeaseStore.getState().generationOf(TAB);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    // Lease holder is now human → an "ai"-tagged command is lease-lost, not stale.
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", staleGen)).toBe("lease-lost");
  });

  it("rejects an AI command as stale after the page navigated (generation bumped)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const oldGen = useBrowserLeaseStore.getState().generationOf(TAB);
    useBrowserLeaseStore.getState().bumpGeneration(TAB); // navigation
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", oldGen)).toBe("stale");
    // A command tagged with the NEW generation is accepted again.
    const newGen = useBrowserLeaseStore.getState().generationOf(TAB);
    expect(useBrowserLeaseStore.getState().validate(TAB, "ai", newGen)).toBe("ok");
  });

  it("treats a command for an unknown tab as lease-lost", () => {
    expect(useBrowserLeaseStore.getState().validate("nope", "ai", 0)).toBe("lease-lost");
  });
});

describe("bumpGeneration (navigation)", () => {
  it("invalidates the AI's in-flight step (a late result must not apply to a navigated page)", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const cancel = vi.fn();
    useBrowserLeaseStore.getState().setInflightCancel(TAB, cancel);
    useBrowserLeaseStore.getState().bumpGeneration(TAB);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(useBrowserLeaseStore.getState().generationOf(TAB)).toBe(1);
  });
});

describe("release", () => {
  it("releases the lease held by the given holder", () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    useBrowserLeaseStore.getState().release(TAB, "ai");
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("is a no-op when released by a non-holder (does not steal the lease)", () => {
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
    expect(useBrowserLeaseStore.getState().generationOf(TAB)).toBe(0);
  });
});
