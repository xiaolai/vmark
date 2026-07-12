// WI-3.3 — SiteReader plugin interface + built-in generic reader + selection
import { describe, it, expect } from "vitest";
import { genericReader, pickReader, type SiteReader } from "./siteReader";

const ARTICLE = `<body><article><h1>Hello</h1><p>Body paragraph long enough to score.</p></article></body>`;

describe("genericReader", () => {
  it("matches any http(s) URL and nothing else", () => {
    expect(genericReader.match("https://example.com/x")).toBe(true);
    expect(genericReader.match("http://example.com")).toBe(true);
    expect(genericReader.match("about:blank")).toBe(false);
    expect(genericReader.match("file:///x")).toBe(false);
  });

  it("reads a page into a ReaderResult (delegates to readPage)", () => {
    const r = genericReader.read(ARTICLE, "https://example.com/post");
    expect(r.title).toBe("Hello");
    expect(r.markdown).toContain("Body paragraph");
    expect(r.url).toBe("https://example.com/post");
  });
});

describe("pickReader", () => {
  const siteReader: SiteReader = {
    id: "example",
    match: (url) => url.includes("example.com"),
    read: () => ({ title: "custom", byline: null, url: "", markdown: "site-specific", textLength: 0 }),
  };

  it("returns the generic reader when no site reader matches", () => {
    expect(pickReader("https://other.org/x", [siteReader])).toBe(genericReader);
    expect(pickReader("https://other.org/x", [])).toBe(genericReader);
  });

  it("returns a matching site-specific reader over the generic one", () => {
    expect(pickReader("https://example.com/x", [siteReader])).toBe(siteReader);
  });

  it("picks the first matching reader when several match (registration order)", () => {
    const a: SiteReader = { id: "a", match: () => true, read: genericReader.read };
    const b: SiteReader = { id: "b", match: () => true, read: genericReader.read };
    expect(pickReader("https://example.com/x", [a, b])).toBe(a);
  });
});
