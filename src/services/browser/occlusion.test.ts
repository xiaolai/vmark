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

  it("stays frozen until the LAST occluder is removed", () => {
    ctl.addOccluder(TAB, "a");
    ctl.addOccluder(TAB, "b");
    ctl.removeOccluder(TAB, "a");
    expect(driver.thaw).not.toHaveBeenCalled();
    expect(ctl.isFrozen(TAB)).toBe(true);
    ctl.removeOccluder(TAB, "b");
    expect(driver.thaw).toHaveBeenCalledWith(TAB);
    expect(ctl.isFrozen(TAB)).toBe(false);
  });

  it("is idempotent — removing an unknown occluder does nothing", () => {
    ctl.removeOccluder(TAB, "never-added");
    expect(driver.thaw).not.toHaveBeenCalled();
    expect(driver.freeze).not.toHaveBeenCalled();
  });

  it("reconciles a rapid open→close to the thawed state", () => {
    ctl.addOccluder(TAB, "x"); // freeze
    ctl.removeOccluder(TAB, "x"); // thaw
    expect(driver.freeze).toHaveBeenCalledTimes(1);
    expect(driver.thaw).toHaveBeenCalledTimes(1);
    expect(ctl.isFrozen(TAB)).toBe(false);
  });

  it("keeps the webview hidden if freeze fails (never shows a stale frame — R2)", async () => {
    driver.freeze.mockRejectedValueOnce(new Error("snapshot failed"));
    ctl.addOccluder(TAB, "x");
    await Promise.resolve();
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

describe("race safety (generation counter)", () => {
  it("only the latest intent is applied when driver ops resolve out of order", async () => {
    // freeze resolves slowly, thaw resolves fast — the controller must end thawed.
    let releaseFreeze: () => void = () => {};
    driver.freeze.mockImplementationOnce(
      () => new Promise<void>((res) => (releaseFreeze = res)),
    );
    ctl.addOccluder(TAB, "x"); // starts (slow) freeze; optimistic frozen
    ctl.removeOccluder(TAB, "x"); // starts thaw; optimistic thawed
    releaseFreeze(); // the stale freeze finally resolves
    await Promise.resolve();
    await Promise.resolve();
    expect(ctl.isFrozen(TAB)).toBe(false); // latest intent (thawed) wins
  });
});
