// @vitest-environment node
/**
 * The delimiter grammar's COLUMN arithmetic (audit R2, #868).
 *
 * `listItemStart` is documented as reporting a marker's COLUMN, and the fence
 * scanner compares those columns across lines to decide where one list item's
 * block ends. It counted CHARACTERS, which is the same number only while the
 * prefix holds no tab — and a blockquote marker may legally be followed by one.
 *
 * @coordinates-with plugins/shared/fenceDelimiter.ts — the module under test
 * @module plugins/shared/fenceDelimiter.test
 */
import { describe, it, expect } from "vitest";
import { columnAfter, listItemStart, containerPrefixParts, TAB_STOP } from "./fenceDelimiter";

describe("columnAfter", () => {
  it("counts a plain run one column per character", () => {
    expect(columnAfter("abc")).toBe(3);
  });

  it("advances a tab to the next tab stop", () => {
    expect(columnAfter("\t")).toBe(TAB_STOP);
    expect(columnAfter("a\t")).toBe(TAB_STOP);
    expect(columnAfter("abc\t")).toBe(TAB_STOP);
    expect(columnAfter("abcd\t")).toBe(TAB_STOP * 2);
  });

  it("continues from the column it is given", () => {
    expect(columnAfter("\t", 1)).toBe(TAB_STOP);
    expect(columnAfter("x", 7)).toBe(8);
  });
});

describe("listItemStart", () => {
  it("is null on a line with no list marker", () => {
    expect(listItemStart("plain text")).toBeNull();
    expect(listItemStart("> quoted")).toBeNull();
  });

  it("reports column 0 for a marker at the margin", () => {
    expect(listItemStart("- item")).toBe(0);
    expect(listItemStart("1. item")).toBe(0);
  });

  it("reports the indent before the marker, not the prefix length", () => {
    expect(listItemStart(" - item")).toBe(1);
    expect(listItemStart("   - item")).toBe(3);
  });

  it("reports the LAST marker's column when items nest", () => {
    expect(listItemStart("- - item")).toBe(2);
  });

  it("expands a tab inside a blockquote prefix to its tab stop", () => {
    // `>` + TAB puts the marker at column 4, not at character index 2 — the
    // number `> - x` reports. Counting characters made the two compare equal,
    // so a nested item read as a sibling.
    expect(containerPrefixParts(">\t- x").map((p) => p.text)).toEqual([">\t", "- "]);
    expect(listItemStart("> - x")).toBe(2);
    expect(listItemStart(">\t- x")).toBe(TAB_STOP);
  });

  it("expands a tab inside an outer list marker", () => {
    // `-` + TAB is a two-character prefix occupying four columns, so the inner
    // marker starts at column 4.
    expect(listItemStart("-\t- x")).toBe(TAB_STOP);
  });
});
