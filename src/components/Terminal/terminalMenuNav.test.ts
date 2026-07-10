import { describe, it, expect } from "vitest";
import { findNextEnabled, findEdgeEnabled, type NavItem } from "./terminalMenuNav";

// [copy(disabled), copyUnwrapped(disabled), paste, selectAll, clear] — the
// no-selection terminal layout, where the first two items are disabled.
const noSelection: NavItem[] = [
  { disabled: true },
  { disabled: true },
  {},
  {},
  {},
];
const allEnabled: NavItem[] = [{}, {}, {}];

describe("findNextEnabled", () => {
  it("moves forward to the next enabled item", () => {
    expect(findNextEnabled(allEnabled, 0, 1)).toBe(1);
  });

  it("skips disabled items going forward", () => {
    // From paste(2) forward → selectAll(3); from clear(4) forward wraps
    // past the two disabled leaders to paste(2).
    expect(findNextEnabled(noSelection, 2, 1)).toBe(3);
    expect(findNextEnabled(noSelection, 4, 1)).toBe(2);
  });

  it("skips disabled items going backward and wraps", () => {
    // From paste(2) back wraps past disabled 1,0 to clear(4).
    expect(findNextEnabled(noSelection, 2, -1)).toBe(4);
  });

  it("wraps forward from the last item", () => {
    expect(findNextEnabled(allEnabled, 2, 1)).toBe(0);
  });

  it("returns the same index when only one item is enabled", () => {
    const oneEnabled: NavItem[] = [{ disabled: true }, {}, { disabled: true }];
    expect(findNextEnabled(oneEnabled, 1, 1)).toBe(1);
    expect(findNextEnabled(oneEnabled, 1, -1)).toBe(1);
  });

  it("returns the current index when every item is disabled", () => {
    const allDisabled: NavItem[] = [{ disabled: true }, { disabled: true }];
    expect(findNextEnabled(allDisabled, 0, 1)).toBe(0);
    expect(findNextEnabled(allDisabled, 1, -1)).toBe(1);
  });

  it("returns -1 for an empty list", () => {
    expect(findNextEnabled([], 0, 1)).toBe(-1);
    expect(findNextEnabled([], 0, -1)).toBe(-1);
  });
});

describe("findEdgeEnabled", () => {
  it("returns the first enabled item (direction 1), skipping disabled leaders", () => {
    expect(findEdgeEnabled(noSelection, 1)).toBe(2);
    expect(findEdgeEnabled(allEnabled, 1)).toBe(0);
  });

  it("returns the last enabled item (direction -1)", () => {
    expect(findEdgeEnabled(noSelection, -1)).toBe(4);
    expect(findEdgeEnabled(allEnabled, -1)).toBe(2);
  });

  it("returns -1 for an empty list", () => {
    expect(findEdgeEnabled([], 1)).toBe(-1);
    expect(findEdgeEnabled([], -1)).toBe(-1);
  });
});
