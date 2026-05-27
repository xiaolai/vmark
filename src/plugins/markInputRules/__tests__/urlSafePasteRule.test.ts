// URL-aware paste-rule filter. Emphasis paste rules MUST NOT match inside
// URL substrings (issue #???) — pasted URLs frequently contain underscores
// (`_drafts/`, `__init__.py`, snake_case query params) and stars
// (rare but possible in query strings). The regex-level intraword guard
// already covers `_word_` flanked by word chars on both sides; this layer
// catches the remaining URL cases where one or both boundary chars are
// non-word path delimiters (`/`, `.`, `?`, `=`, `&`).

import { describe, it, expect } from "vitest";
import {
  findUrlRanges,
  findMatchesOutsideUrls,
  buildUrlSafeFinder,
} from "../urlSafePasteRule";

function spans(matches: { index: number; 0: string }[]): string[] {
  return matches.map((m) => m[0]);
}

describe("findUrlRanges", () => {
  it("returns an empty array for plain text", () => {
    expect(findUrlRanges("just a sentence with no link")).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(findUrlRanges("")).toEqual([]);
  });

  it("locates a single https URL", () => {
    const text = "see https://example.com/foo for details";
    const ranges = findUrlRanges(text);
    expect(ranges).toEqual([{ start: 4, end: 27 }]);
    expect(text.slice(4, 27)).toBe("https://example.com/foo");
  });

  it("locates both http and https URLs", () => {
    const text = "old http://a.test/x new https://b.test/y";
    expect(spans(findUrlRanges(text).map((r) => ({ index: r.start, 0: text.slice(r.start, r.end) })))).toEqual([
      "http://a.test/x",
      "https://b.test/y",
    ]);
  });

  it("handles other URL schemes (file://, ftp://, ssh://)", () => {
    const text = "open file:///path/to/x and ftp://server/d";
    const ranges = findUrlRanges(text);
    expect(ranges).toHaveLength(2);
  });

  it("locates www-prefixed bare URLs", () => {
    const text = "visit www.example.com/foo today";
    const ranges = findUrlRanges(text);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe(
      "www.example.com/foo",
    );
  });

  it("includes underscores inside the URL within the matched range", () => {
    const text =
      "https://github.com/python/cpython/blob/main/Lib/__init__.py is the file";
    const [range] = findUrlRanges(text);
    expect(text.slice(range.start, range.end)).toBe(
      "https://github.com/python/cpython/blob/main/Lib/__init__.py",
    );
  });

  it("stops at whitespace boundaries", () => {
    const text = "before https://x.test/a after";
    const [range] = findUrlRanges(text);
    expect(text.slice(range.start, range.end)).toBe("https://x.test/a");
  });

  it("matches case-insensitively on the scheme", () => {
    expect(findUrlRanges("HTTPS://X.test/y")).toHaveLength(1);
  });
});

describe("findMatchesOutsideUrls", () => {
  const UNDERSCORE_ITALIC = /(?<=^|[^\w_])(_(?!\s+_)((?:[^_]+))_(?![\w_])(?!\s+_))/g;
  const UNDERSCORE_BOLD = /(?<=^|[^\w_])(__(?!\s+__)((?:[^_]+))__(?![\w_])(?!\s+__))/g;

  it("returns all regex matches when the text contains no URL", () => {
    const matches = findMatchesOutsideUrls(
      "before _word_ after _more_",
      UNDERSCORE_ITALIC,
    );
    expect(spans(matches)).toEqual(["_word_", "_more_"]);
  });

  it("filters out matches that fall entirely inside a URL", () => {
    const text =
      "https://github.com/python/cpython/Lib/__init__.py";
    const matches = findMatchesOutsideUrls(text, UNDERSCORE_BOLD);
    expect(matches).toEqual([]);
  });

  it("filters out a match that overlaps the start of a URL", () => {
    // Contrived: an italic span that straddles the URL boundary.
    const text = "see _foo https://x.test/y_ end";
    const matches = findMatchesOutsideUrls(text, UNDERSCORE_ITALIC);
    expect(matches).toEqual([]);
  });

  it("keeps matches that fall completely OUTSIDE the URL", () => {
    const text =
      "before _important_ note https://github.com/python/__init__.py end _another_";
    const matches = findMatchesOutsideUrls(text, UNDERSCORE_ITALIC);
    expect(spans(matches)).toEqual(["_important_", "_another_"]);
  });

  it("keeps non-URL bold matches and drops URL-internal bold matches", () => {
    const text = "see __bold__ then https://example.com/__init__.py end";
    const matches = findMatchesOutsideUrls(text, UNDERSCORE_BOLD);
    expect(spans(matches)).toEqual(["__bold__"]);
  });

  it("filters URL-internal italics around Jekyll-style path segments", () => {
    const text = "site https://example.com/_drafts_/post is the blog";
    const matches = findMatchesOutsideUrls(text, UNDERSCORE_ITALIC);
    expect(matches).toEqual([]);
  });

  it("returns an empty array when the regex has no matches at all", () => {
    expect(findMatchesOutsideUrls("plain text", UNDERSCORE_ITALIC)).toEqual([]);
  });

  it("each returned match has the expected `.index` for downstream consumers", () => {
    const text = "_a_ and _b_";
    const matches = findMatchesOutsideUrls(text, UNDERSCORE_ITALIC);
    expect(matches.map((m) => m.index)).toEqual([0, 8]);
  });

  it("preserves the original regex's global state by using a fresh RegExp", () => {
    // Running twice should yield the same result — proves the helper
    // doesn't leak lastIndex back into the caller's regex object.
    const text = "before _a_ end";
    expect(spans(findMatchesOutsideUrls(text, UNDERSCORE_ITALIC))).toEqual(["_a_"]);
    expect(spans(findMatchesOutsideUrls(text, UNDERSCORE_ITALIC))).toEqual(["_a_"]);
  });
});

describe("buildUrlSafeFinder", () => {
  const UNDERSCORE_ITALIC = /(?<=^|[^\w_])(_(?!\s+_)((?:[^_]+))_(?![\w_])(?!\s+_))/g;

  it("returns null when no non-URL matches survive", () => {
    const finder = buildUrlSafeFinder(UNDERSCORE_ITALIC);
    expect(finder("plain text with no emphasis")).toBeNull();
    expect(finder("only in url: https://x.test/_foo_")).toBeNull();
  });

  it("returns the surviving matches when at least one is outside any URL", () => {
    const finder = buildUrlSafeFinder(UNDERSCORE_ITALIC);
    const result = finder("see _key_ then https://x.test/_inside_/ end");
    expect(result).not.toBeNull();
    expect(result!.map((m) => m.text)).toEqual(["_key_"]);
    expect(result![0].index).toBe(4);
  });
});
