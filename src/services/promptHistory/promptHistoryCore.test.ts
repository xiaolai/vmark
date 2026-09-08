// @vitest-environment node
/**
 * The pure core of the prompt-history interaction.
 *
 * The match rule is the point (audit #753): cycling and the ghost hint MUST
 * agree, and they must both mean PREFIX. They disagreed for as long as cycling
 * delegated to the store's substring `getFilteredEntries` while the hint used
 * `startsWith` — a divergence no test could see, because each side was only
 * ever exercised with drafts where the two rules happen to coincide.
 */
import { describe, expect, it } from "vitest";
import {
  clampToRows,
  filterByPrefix,
  ghostSuffix,
  matchesPrefix,
} from "./promptHistoryCore";

const ENTRIES = ["foo bar", "barbecue", "Barn owl", "baz"];

describe("matchesPrefix", () => {
  it("matches at the START only, never mid-string", () => {
    expect(matchesPrefix("barbecue", "bar")).toBe(true);
    expect(matchesPrefix("foo bar", "bar")).toBe(false);
  });

  it("is case-insensitive in both directions", () => {
    expect(matchesPrefix("Barn owl", "bar")).toBe(true);
    expect(matchesPrefix("barbecue", "BAR")).toBe(true);
  });

  it("treats the empty prefix as matching anything", () => {
    expect(matchesPrefix("", "")).toBe(true);
    expect(matchesPrefix("anything", "")).toBe(true);
  });
});

describe("filterByPrefix", () => {
  it("keeps only entries the draft starts, in store (MRU) order", () => {
    expect(filterByPrefix(ENTRIES, "bar")).toEqual(["barbecue", "Barn owl"]);
  });

  it("does NOT match a substring — the defect this rule replaced", () => {
    expect(filterByPrefix(ENTRIES, "bar")).not.toContain("foo bar");
  });

  it("returns every entry for an empty draft, as a copy", () => {
    const all = filterByPrefix(ENTRIES, "");
    expect(all).toEqual(ENTRIES);
    expect(all).not.toBe(ENTRIES);
  });

  it("returns nothing when no entry starts with the draft", () => {
    expect(filterByPrefix(ENTRIES, "zzz")).toEqual([]);
    expect(filterByPrefix([], "bar")).toEqual([]);
  });
});

describe("ghostSuffix", () => {
  it("completes from the most recent matching entry", () => {
    expect(ghostSuffix(ENTRIES, "bar")).toBe("becue");
  });

  it("agrees with filterByPrefix: no hint where cycling would find nothing", () => {
    expect(filterByPrefix(ENTRIES, "oo")).toEqual([]);
    expect(ghostSuffix(ENTRIES, "oo")).toBe("");
  });

  it("is empty for an empty draft, so an untouched input shows no hint", () => {
    expect(ghostSuffix(ENTRIES, "")).toBe("");
  });

  it("is empty when the draft already equals the entry", () => {
    expect(ghostSuffix(["baz"], "baz")).toBe("");
  });

  it("preserves the stored entry's casing in the completion", () => {
    expect(ghostSuffix(["Barn owl"], "bar")).toBe("n owl");
  });
});

describe("clampToRows", () => {
  it("clamps at BOTH ends — an upper-only clamp pinned an empty result at -1 (#387)", () => {
    expect(clampToRows(5, 0)).toBe(0);
    expect(clampToRows(-1, 0)).toBe(0);
    expect(clampToRows(-3, 4)).toBe(0);
  });

  it("keeps an in-range index and stops at the last row", () => {
    expect(clampToRows(2, 4)).toBe(2);
    expect(clampToRows(9, 4)).toBe(3);
  });
});
