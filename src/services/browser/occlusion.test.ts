// WI-1.4 / R2 — occlusion controller: freeze the native webview under overlays
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OcclusionController, type OcclusionDriver } from "./occlusion";

const TAB = "b1";

function makeDriver(): OcclusionDriver & { freeze: ReturnType<typeof vi.fn>; thaw: ReturnType<typeof vi.fn> } {
  return {
    freeze: vi.fn().mockResolvedValue(undefined),
    thaw: vi.fn().mockResolvedValue(undefined),
  };
}

let driver: ReturnType<typeof makeDriver>;
let ctl: OcclusionController;
beforeEach(() => {
  driver = makeDriver();
  ctl = new OcclusionController(driver);
});

/** Let the serialized per-tab op loop drain (each driver op is awaited). */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("OcclusionController", () => {
  it("freezes the webview when the first occluder appears", () => {
    ctl.addOccluder(TAB, "command-palette");
    expect(driver.freeze).toHaveBeenCalledWith(TAB);
    expect(ctl.isFrozen(TAB)).toBe(true);
  });

  it("freezes only once when multiple occluders overlap", () => {
    ctl.addOccluder(TAB, "command-palette");
    ctl.addOccluder(TAB, "dialog");
    expect(driver.freeze).toHaveBeenCalledTimes(1);
  });

  it("stays frozen until the LAST occluder is removed", async () => {
    ctl.addOccluder(TAB, "a");
    ctl.addOccluder(TAB, "b");
    ctl.removeOccluder(TAB, "a");
    await flush();
    expect(driver.thaw).not.toHaveBeenCalled();
    expect(ctl.isFrozen(TAB)).toBe(true);
    ctl.removeOccluder(TAB, "b");
    await flush();
    expect(driver.thaw).toHaveBeenCalledWith(TAB);
    expect(ctl.isFrozen(TAB)).toBe(false);
  });

  it("is idempotent — removing an unknown occluder does nothing", () => {
    ctl.removeOccluder(TAB, "never-added");
    expect(driver.thaw).not.toHaveBeenCalled();
    expect(driver.freeze).not.toHaveBeenCalled();
  });

  it("reconciles a rapid open→close to the thawed state", async () => {
    ctl.addOccluder(TAB, "x"); // freeze
    ctl.removeOccluder(TAB, "x"); // thaw (sent once the freeze completes)
    await flush();
    expect(driver.freeze).toHaveBeenCalledTimes(1);
    expect(driver.thaw).toHaveBeenCalledTimes(1);
    expect(ctl.isFrozen(TAB)).toBe(false);
  });

  it("keeps the webview hidden if freeze fails (never shows a stale frame — R2)", async () => {
    driver.freeze.mockRejectedValueOnce(new Error("snapshot failed"));
    ctl.addOccluder(TAB, "x");
    await flush();
    // A failed snapshot falls back to keeping the native view hidden.
    expect(ctl.isFrozen(TAB)).toBe(true);
  });

  it("scopes state per tab", () => {
    ctl.addOccluder("a", "x");
    expect(ctl.isFrozen("a")).toBe(true);
    expect(ctl.isFrozen("b")).toBe(false);
  });

  it("removeTab clears occlusion state without thawing", () => {
    ctl.addOccluder(TAB, "x");
    driver.thaw.mockClear();
    ctl.removeTab(TAB);
    expect(ctl.isFrozen(TAB)).toBe(false);
    expect(driver.thaw).not.toHaveBeenCalled(); // the tab is gone, not thawed
  });
});

describe("race safety (serialized driver ops)", () => {
  it("only the latest intent is applied when driver ops resolve out of order", async () => {
    // freeze resolves slowly, thaw resolves fast — the controller must end thawed.
    let releaseFreeze: () => void = () => {};
    driver.freeze.mockImplementationOnce(
      () => new Promise<void>((res) => (releaseFreeze = res)),
    );
    ctl.addOccluder(TAB, "x"); // starts (slow) freeze; optimistic frozen
    ctl.removeOccluder(TAB, "x"); // intent is now thawed
    expect(ctl.isFrozen(TAB)).toBe(false); // reported immediately
    releaseFreeze(); // the freeze finally resolves
    await flush();
    expect(ctl.isFrozen(TAB)).toBe(false); // latest intent (thawed) wins
  });

  it("never has two native ops in flight for one tab — the LAST call the driver sees is the latest intent", async () => {
    // The real driver hides/shows a native view; two overlapping ops can be
    // applied out of order natively, leaving the view hidden with no overlay
    // above it. Serializing per tab makes the driver's call ORDER the intent order.
    const calls: string[] = [];
    let releaseFreeze: () => void = () => {};
    driver.freeze.mockImplementation(() => {
      calls.push("freeze");
      return new Promise<void>((res) => (releaseFreeze = res));
    });
    driver.thaw.mockImplementation(() => {
      calls.push("thaw");
      return Promise.resolve();
    });

    ctl.addOccluder(TAB, "x"); // freeze starts (slow)
    ctl.removeOccluder(TAB, "x"); // thaw intended — must NOT be sent yet
    expect(calls).toEqual(["freeze"]);

    releaseFreeze();
    await flush();
    expect(calls).toEqual(["freeze", "thaw"]); // thaw only after freeze completed
  });

  it("coalesces intent churn while an op is in flight (a→b→a issues no redundant op)", async () => {
    let releaseFreeze: () => void = () => {};
    driver.freeze.mockImplementationOnce(() => new Promise<void>((res) => (releaseFreeze = res)));
    ctl.addOccluder(TAB, "x"); // freeze starts
    ctl.removeOccluder(TAB, "x"); // intent: thawed
    ctl.addOccluder(TAB, "y"); // intent: frozen again — matches the op in flight
    releaseFreeze();
    await flush();
    expect(driver.thaw).not.toHaveBeenCalled(); // nothing to undo
    expect(driver.freeze).toHaveBeenCalledTimes(1);
    expect(ctl.isFrozen(TAB)).toBe(true);
  });

  it("a failed freeze is retried on the next reconcile (the view was never hidden)", async () => {
    driver.freeze.mockRejectedValueOnce(new Error("snapshot failed"));
    ctl.addOccluder(TAB, "x");
    await flush();
    expect(ctl.isFrozen(TAB)).toBe(true); // intent stands (never show a stale frame)

    ctl.addOccluder(TAB, "y"); // any later reconcile retries the unconfirmed freeze
    await flush();
    expect(driver.freeze).toHaveBeenCalledTimes(2);
  });

  it("does not thaw a view the driver never froze (failed freeze, then the overlay closes)", async () => {
    driver.freeze.mockRejectedValueOnce(new Error("snapshot failed"));
    ctl.addOccluder(TAB, "x");
    await flush();
    ctl.removeOccluder(TAB, "x");
    await flush();
    expect(driver.thaw).not.toHaveBeenCalled(); // the native view is already visible
    expect(ctl.isFrozen(TAB)).toBe(false);
  });

  it("a tab closed mid-op stops the loop (no op against a destroyed view)", async () => {
    let releaseFreeze: () => void = () => {};
    driver.freeze.mockImplementationOnce(() => new Promise<void>((res) => (releaseFreeze = res)));
    ctl.addOccluder(TAB, "x");
    ctl.removeOccluder(TAB, "x"); // thaw intended
    ctl.removeTab(TAB); // …but the tab closed first
    releaseFreeze();
    await flush();
    expect(driver.thaw).not.toHaveBeenCalled();
    expect(ctl.isFrozen(TAB)).toBe(false);
  });
});
