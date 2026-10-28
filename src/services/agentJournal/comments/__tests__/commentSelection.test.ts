// @vitest-environment node
// WI-AL3.2 — a comment's selection in the Markdown the journal anchors to, in UTF-16 units: Markdown offsets (Source's own, or a WYSIWYG selection mapped exactly) are exact as the editor held them (a caret is a collapsed selection the journal widens to its block); a WYSIWYG selection that could not be mapped is a guess, never exact: the occurrence nearest the estimate, or the estimate itself when its Markdown occurs nowhere; offsets read against other text (even where the selection now occurs once), out-of-range or reversed bounds are never sent as exact; finding the nearest occurrence costs nothing in proportion to how often it repeats
import { describe, it, expect } from "vitest";
import { growthExponent, measureGrowth } from "@/test/cpuClock";
import { locateSelection } from "../commentSelection";

const TEXT = "# Title\n\nhello world\n\nhello again 👋 world\n";

describe("locateSelection — Markdown offsets", () => {
  it("keeps the editor's offsets, exact", () => {
    const at = TEXT.indexOf("world");
    expect(locateSelection(TEXT, { mode: "markdown", from: at, to: at + 5, selected: "world", text: TEXT })).toEqual({ start: at, end: at + 5, precision: "exact" });
  });

  it("counts UTF-16 units past an astral character", () => {
    const at = TEXT.lastIndexOf("world");
    const got = locateSelection(TEXT, { mode: "markdown", from: at, to: at + 5, selected: "world", text: TEXT });
    expect(TEXT.slice(got.start, got.end)).toBe("world");
    expect(got.start).toBe(at);
  });

  it("sends a caret as a collapsed selection", () => {
    expect(locateSelection(TEXT, { mode: "markdown", from: 3, to: 3, selected: "", text: TEXT })).toEqual({ start: 3, end: 3, precision: "exact" });
  });

  it("reads offsets taken against other text as an approximate search", () => {
    const stale = "x".repeat(30);
    const got = locateSelection(TEXT, { mode: "markdown", from: 9, to: 14, selected: "hello", text: stale });
    expect(got.precision).toBe("approximate");
    expect(TEXT.slice(got.start, got.end)).toBe("hello");
  });

  it("never sends offsets read against other text as exact, even where the selection now occurs once", () => {
    const before = "hello one\n\nhello two\n";
    const after = "one\n\nhello two\n";
    const got = locateSelection(after, { mode: "markdown", from: 0, to: 5, selected: "hello", text: before });
    expect(got).toEqual({ start: after.indexOf("hello"), end: after.indexOf("hello") + 5, precision: "approximate" });
  });

  it("clamps bounds past the end and orders reversed ones, approximate", () => {
    expect(locateSelection(TEXT, { mode: "markdown", from: 999, to: 2, selected: "", text: TEXT })).toEqual({ start: 2, end: TEXT.length, precision: "approximate" });
  });
});

describe("locateSelection — an unmapped WYSIWYG selection", () => {
  it("is a guess, approximate, even where the selected Markdown occurs once", () => {
    const at = TEXT.indexOf("again");
    expect(locateSelection(TEXT, { mode: "wysiwyg", selected: "again", estimate: 0 })).toEqual({ start: at, end: at + 5, precision: "approximate" });
  });

  it("picks the occurrence nearest the estimate, approximate, when it repeats", () => {
    const second = TEXT.lastIndexOf("hello");
    expect(locateSelection(TEXT, { mode: "wysiwyg", selected: "hello", estimate: second - 2 })).toEqual({ start: second, end: second + 5, precision: "approximate" });
    const first = TEXT.indexOf("hello");
    expect(locateSelection(TEXT, { mode: "wysiwyg", selected: "hello", estimate: first + 1 }).start).toBe(first);
  });

  it("falls back to a collapsed approximate selection at the estimate when the Markdown is nowhere", () => {
    expect(locateSelection(TEXT, { mode: "wysiwyg", selected: "**bold**", estimate: 12 })).toEqual({ start: 12, end: 12, precision: "approximate" });
  });

  it("clamps the estimate into the text and never splits a surrogate pair", () => {
    expect(locateSelection(TEXT, { mode: "wysiwyg", selected: "", estimate: 1e9 }).start).toBe(TEXT.length);
    const emoji = TEXT.indexOf("👋");
    const got = locateSelection(TEXT, { mode: "wysiwyg", selected: "", estimate: emoji + 1 });
    expect(got.start).toBe(emoji);
  });

  it("handles an empty document", () => {
    expect(locateSelection("", { mode: "wysiwyg", selected: "", estimate: 5 })).toEqual({ start: 0, end: 0, precision: "approximate" });
  });
});

describe("locateSelection — a selection that repeats throughout a large document", () => {
  it("finds the nearest occurrence at a cost that does not grow with the repeats", () => {
    const at = (doc: string) => locateSelection(doc, { mode: "wysiwyg", selected: "a", estimate: doc.length / 2 });
    const growth = measureGrowth(at, "a".repeat(200_000), "a".repeat(3_200_000));
    expect(growthExponent(growth, 200_000, 3_200_000)).toBeLessThan(0.5);
  });

  it("prefers the earlier of two equally near occurrences", () => {
    expect(locateSelection("ab..ab", { mode: "wysiwyg", selected: "..", estimate: 2 }).start).toBe(2);
    expect(locateSelection("x.y.z", { mode: "wysiwyg", selected: ".", estimate: 2 }).start).toBe(1);
  });
});
