// @vitest-environment node
/**
 * Find in Files' minimum query length (#1598): two characters, counted in
 * code points so a two-character CJK word searches and a lone emoji (two
 * UTF-16 units) does not.
 */
import { describe, it, expect } from "vitest";
import {
  MIN_CONTENT_SEARCH_CHARS,
  contentSearchQueryLength,
  isSearchableQuery,
} from "./contentSearchQuery";

describe("contentSearchQuery", () => {
  it("is two characters", () => {
    expect(MIN_CONTENT_SEARCH_CHARS).toBe(2);
  });

  it.each([
    ["选址", true],
    ["招聘", true],
    ["ab", true],
    ["😀😀", true],
    ["选", false],
    ["a", false],
    ["😀", false],
    ["  选 ", false],
    ["", false],
    ["   ", false],
  ])("%j searchable: %s", (query, expected) => {
    expect(isSearchableQuery(query)).toBe(expected);
  });

  it("counts code points of the trimmed query", () => {
    expect(contentSearchQueryLength(" 选址 ")).toBe(2);
    expect(contentSearchQueryLength("😀")).toBe(1);
    expect(contentSearchQueryLength("  ")).toBe(0);
  });
});
