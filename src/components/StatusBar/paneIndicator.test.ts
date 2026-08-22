// @vitest-environment node
// WI-DSPL1.1 — which pill reads as "shown in the other pane".
import { describe, expect, it } from "vitest";
import { DEFAULT_SPLIT, type WindowSplit } from "@/stores/paneStore";
import { paneIndicatorTabId } from "./paneIndicator";

const split = (o: Partial<WindowSplit>): WindowSplit => ({ ...DEFAULT_SPLIT, ...o });

describe("paneIndicatorTabId", () => {
  it("is null when no split is enabled", () => {
    expect(paneIndicatorTabId(undefined, false)).toBeNull();
    expect(paneIndicatorTabId(split({ enabled: false, primaryTabId: "a" }), false)).toBeNull();
  });

  it("marks the pane that is NOT focused, in both directions (D8)", () => {
    // `openSplit` focuses the secondary, so marking `secondaryTabId` by
    // position marks the FOCUSED pill — backwards on the first frame.
    const s = split({ enabled: true, primaryTabId: "a", secondaryTabId: "b" });
    expect(paneIndicatorTabId({ ...s, focusedPane: "secondary" }, false)).toBe("a");
    expect(paneIndicatorTabId({ ...s, focusedPane: "primary" }, false)).toBe("b");
  });

  it("is suppressed while the browser workspace is active (R3)", () => {
    const s = split({ enabled: true, primaryTabId: "a", secondaryTabId: "b", focusedPane: "primary" });
    expect(paneIndicatorTabId(s, false)).toBe("b");
    expect(paneIndicatorTabId(s, true)).toBeNull();
  });

  it("is null for a legal empty secondary", () => {
    const s = split({ enabled: true, primaryTabId: "a", secondaryTabId: null, focusedPane: "primary" });
    expect(paneIndicatorTabId(s, false)).toBeNull();
  });

  it("never marks the focused pill, even for a stray A/A split", () => {
    const s = split({ enabled: true, primaryTabId: "a", secondaryTabId: "a", focusedPane: "primary" });
    expect(paneIndicatorTabId(s, false)).toBeNull();
  });

  it("is correct across every legal (focusedPane × pane occupancy) combination", () => {
    const ids: (string | null)[] = [null, "a", "b"];
    for (const primaryTabId of ids) {
      for (const secondaryTabId of ids) {
        for (const focusedPane of ["primary", "secondary"] as const) {
          const s = split({ enabled: true, primaryTabId, secondaryTabId, focusedPane });
          const got = paneIndicatorTabId(s, false);
          const focused = focusedPane === "primary" ? primaryTabId : secondaryTabId;
          const other = focusedPane === "primary" ? secondaryTabId : primaryTabId;
          expect(got).toBe(other && other !== focused ? other : null);
          // R3 holds over the whole domain, not just one row.
          expect(paneIndicatorTabId(s, true)).toBeNull();
        }
      }
    }
  });
});
