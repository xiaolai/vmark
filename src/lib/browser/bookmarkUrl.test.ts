// WI-S3.1 — bookmark identity.
//
// The v2 plan deduped bookmarks with the origin guard's canonicalizeOrigin, which
// DISCARDS the path — every page on a host would have collapsed into one bookmark. That
// is the headline bug, but the subtler one is over-normalizing in the other direction:
// sorting query parameters or stripping "tracking" params both CHANGE THE IDENTITY of the
// thing the user asked to remember. A bookmark is a promise to take them back to exactly
// what they saw.
import { describe, it, expect } from "vitest";
import { canonicalizeBookmarkUrl } from "./bookmarkUrl";

describe("canonicalizeBookmarkUrl — normalizes what is meaningless", () => {
  it("lowercases the scheme and host", () => {
    expect(canonicalizeBookmarkUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
  });

  it("keeps path case — a path is case-sensitive and the server decides", () => {
    expect(canonicalizeBookmarkUrl("https://example.com/CaseMatters")).toBe(
      "https://example.com/CaseMatters",
    );
  });

  it("drops a default port", () => {
    expect(canonicalizeBookmarkUrl("https://example.com:443/x")).toBe("https://example.com/x");
    expect(canonicalizeBookmarkUrl("http://example.com:80/x")).toBe("http://example.com/x");
  });

  it("keeps a non-default port", () => {
    expect(canonicalizeBookmarkUrl("https://example.com:8443/x")).toBe(
      "https://example.com:8443/x",
    );
  });

  it("strips a trailing dot from the host", () => {
    expect(canonicalizeBookmarkUrl("https://example.com./x")).toBe("https://example.com/x");
  });
});

describe("canonicalizeBookmarkUrl — preserves what carries meaning", () => {
  it("keeps the path, so two pages on one site are two bookmarks", () => {
    const a = canonicalizeBookmarkUrl("https://example.com/a");
    const b = canonicalizeBookmarkUrl("https://example.com/b");
    expect(a).not.toBe(b);
  });

  it("keeps the query EXACTLY — order included", () => {
    // Sorting these would merge two urls the server may treat as different, and would
    // silently rewrite what the user bookmarked.
    expect(canonicalizeBookmarkUrl("https://example.com/s?b=2&a=1")).toBe(
      "https://example.com/s?b=2&a=1",
    );
    expect(canonicalizeBookmarkUrl("https://example.com/s?a=1&b=2")).not.toBe(
      canonicalizeBookmarkUrl("https://example.com/s?b=2&a=1"),
    );
  });

  it("keeps duplicate query keys — dropping one changes what the server sees", () => {
    expect(canonicalizeBookmarkUrl("https://example.com/s?t=1&t=2")).toBe(
      "https://example.com/s?t=1&t=2",
    );
  });

  it("keeps 'tracking' params — they are not ours to remove", () => {
    // A url with utm_* may resolve differently, and stripping it is a guess about what
    // the user meant. A bookmark records what they saw, not what we wish they had seen.
    expect(canonicalizeBookmarkUrl("https://example.com/p?utm_source=x")).toBe(
      "https://example.com/p?utm_source=x",
    );
  });

  it("KEEPS the fragment — bookmarking a section is a deliberate act", () => {
    // This is the one place bookmark identity differs from TAB identity: a tab treats
    // page#a and page#b as the same document (it is), but a user who bookmarks a section
    // asked for that section.
    expect(canonicalizeBookmarkUrl("https://example.com/doc#install")).toBe(
      "https://example.com/doc#install",
    );
    expect(canonicalizeBookmarkUrl("https://example.com/doc#install")).not.toBe(
      canonicalizeBookmarkUrl("https://example.com/doc#usage"),
    );
  });

  it("keeps userinfo — different credentials are different destinations", () => {
    expect(canonicalizeBookmarkUrl("https://alice@example.com/x")).toBe(
      "https://alice@example.com/x",
    );
  });
});

describe("canonicalizeBookmarkUrl — refuses what cannot be a bookmark", () => {
  it("rejects a non-http(s) scheme", () => {
    expect(canonicalizeBookmarkUrl("about:blank")).toBeNull();
    expect(canonicalizeBookmarkUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeBookmarkUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects an unparseable url", () => {
    expect(canonicalizeBookmarkUrl("not a url")).toBeNull();
    expect(canonicalizeBookmarkUrl("")).toBeNull();
  });

  it("rejects an empty or malformed host", () => {
    expect(canonicalizeBookmarkUrl("https://")).toBeNull();
    expect(canonicalizeBookmarkUrl("https://.com/x")).toBeNull();
  });
});
