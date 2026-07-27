// WI-3.1 — Search must answer "how many, which one, any at all" (T12).
// WI-3.2 — Case / whole-word / regex toggles feed xterm's ISearchOptions.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SEARCH_TOGGLES,
  toSearchOptions,
  describeSearchResult,
  isUsableSearchQuery,
  type TerminalSearchToggles,
} from "./terminalSearchOptions";

describe("DEFAULT_SEARCH_TOGGLES (Q5 — reset, do not persist)", () => {
  it("starts with every toggle off", () => {
    // Q5: toggles reset each time the bar opens, matching the editor's
    // FindBar and avoiding a settings-schema change.
    expect(DEFAULT_SEARCH_TOGGLES).toEqual({
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
  });

  it("is not mutable shared state", () => {
    const a = { ...DEFAULT_SEARCH_TOGGLES, regex: true };
    expect(DEFAULT_SEARCH_TOGGLES.regex).toBe(false);
    expect(a.regex).toBe(true);
  });
});

describe("toSearchOptions (WI-3.2)", () => {
  it("maps every toggle onto the xterm ISearchOptions field of the same name", () => {
    const toggles: TerminalSearchToggles = {
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    };
    expect(toSearchOptions(toggles)).toEqual({
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    });
  });

  it("passes the off state through explicitly rather than omitting it", () => {
    // Omitting a field would let a stale option linger inside the addon
    // between calls; sending false every time is unambiguous.
    expect(toSearchOptions(DEFAULT_SEARCH_TOGGLES)).toEqual({
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
  });
});

describe("isUsableSearchQuery (WI-3.2)", () => {
  it("accepts any query when regex is off", () => {
    expect(isUsableSearchQuery("[", { ...DEFAULT_SEARCH_TOGGLES })).toBe(true);
    expect(isUsableSearchQuery("a(b", { ...DEFAULT_SEARCH_TOGGLES })).toBe(true);
    expect(isUsableSearchQuery("*", { ...DEFAULT_SEARCH_TOGGLES })).toBe(true);
  });

  it("rejects a syntactically invalid regex when regex is on", () => {
    // Typing a regex is incremental: "[" is a legal keystroke on the way to
    // "[a-z]". Handing it to the addon throws, so it must be caught here.
    const on = { ...DEFAULT_SEARCH_TOGGLES, regex: true };
    expect(isUsableSearchQuery("[", on)).toBe(false);
    expect(isUsableSearchQuery("(", on)).toBe(false);
    expect(isUsableSearchQuery("a{2,1}", on)).toBe(false);
    expect(isUsableSearchQuery("\\", on)).toBe(false);
  });

  it("accepts a valid regex when regex is on", () => {
    const on = { ...DEFAULT_SEARCH_TOGGLES, regex: true };
    expect(isUsableSearchQuery("[a-z]+", on)).toBe(true);
    expect(isUsableSearchQuery("^err", on)).toBe(true);
  });

  it("treats an empty query as unusable regardless of toggles", () => {
    expect(isUsableSearchQuery("", DEFAULT_SEARCH_TOGGLES)).toBe(false);
    expect(isUsableSearchQuery("", { ...DEFAULT_SEARCH_TOGGLES, regex: true })).toBe(false);
  });
});

describe("describeSearchResult (WI-3.1)", () => {
  it("shows nothing for an empty query", () => {
    expect(describeSearchResult({ resultIndex: 0, resultCount: 3 }, "")).toEqual({
      kind: "none",
    });
  });

  it("shows nothing before the addon has reported anything", () => {
    expect(describeSearchResult(null, "err")).toEqual({ kind: "none" });
  });

  it("reports a 1-based position within the count", () => {
    // xterm's resultIndex is 0-based; humans count from 1.
    expect(describeSearchResult({ resultIndex: 2, resultCount: 17 }, "e")).toEqual({
      kind: "position",
      index: 3,
      count: 17,
    });
    expect(describeSearchResult({ resultIndex: 0, resultCount: 1 }, "e")).toEqual({
      kind: "position",
      index: 1,
      count: 1,
    });
  });

  it("reports no-match for a non-empty query with zero results", () => {
    expect(describeSearchResult({ resultIndex: -1, resultCount: 0 }, "zzz")).toEqual({
      kind: "noMatch",
    });
    expect(describeSearchResult({ resultIndex: 0, resultCount: 0 }, "zzz")).toEqual({
      kind: "noMatch",
    });
  });

  it("reports a count WITHOUT a position when the match threshold is exceeded", () => {
    // The easy miss: xterm sets resultIndex to -1 when it stops tracking the
    // active match because there are too many. Rendering that as "0 / N" is a
    // lie, and rendering it as no-match is worse — there are N matches.
    expect(describeSearchResult({ resultIndex: -1, resultCount: 5000 }, "e")).toEqual({
      kind: "countOnly",
      count: 5000,
    });
  });

  it("treats any negative index with a non-zero count as countOnly", () => {
    expect(describeSearchResult({ resultIndex: -2, resultCount: 9 }, "e")).toEqual({
      kind: "countOnly",
      count: 9,
    });
  });

  it("guards against a non-finite or negative count from the addon", () => {
    expect(describeSearchResult({ resultIndex: 0, resultCount: -1 }, "e")).toEqual({
      kind: "noMatch",
    });
    expect(
      describeSearchResult({ resultIndex: 0, resultCount: Number.NaN }, "e"),
    ).toEqual({ kind: "noMatch" });
  });

  it("clamps a position that exceeds the count rather than showing 4 / 3", () => {
    expect(describeSearchResult({ resultIndex: 9, resultCount: 3 }, "e")).toEqual({
      kind: "countOnly",
      count: 3,
    });
  });
});
