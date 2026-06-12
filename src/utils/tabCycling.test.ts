// Tab cycling selection (audit 20260612 H27).

import { describe, it, expect } from "vitest";
import { cycleTabId } from "./tabCycling";

const IDS = ["a", "b", "c"];

describe("cycleTabId", () => {
  it.each([
    { active: "a", dir: "next", expected: "b" },
    { active: "b", dir: "next", expected: "c" },
    { active: "c", dir: "next", expected: "a", label: "wraps forward" },
    { active: "b", dir: "previous", expected: "a" },
    { active: "a", dir: "previous", expected: "c", label: "wraps backward" },
  ] as const)("$active --$dir--> $expected", ({ active, dir, expected }) => {
    expect(cycleTabId(IDS, active, dir)).toBe(expected);
  });

  it("returns null with fewer than two tabs", () => {
    expect(cycleTabId(["a"], "a", "next")).toBeNull();
    expect(cycleTabId([], null, "next")).toBeNull();
  });

  it("returns null when the active tab is unknown or null", () => {
    expect(cycleTabId(IDS, "missing", "next")).toBeNull();
    expect(cycleTabId(IDS, null, "next")).toBeNull();
  });
});
