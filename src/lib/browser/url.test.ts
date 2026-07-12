// WI-1.1 — browser URL canonicalization for tab dedup + persistence
import { describe, it, expect } from "vitest";
import { canonicalizeBrowserUrl } from "./url";

describe("canonicalizeBrowserUrl", () => {
  it("lowercases scheme and host", () => {
    expect(canonicalizeBrowserUrl("HTTPS://EXAMPLE.COM/Path")).toBe(
      "https://example.com/Path",
    );
  });

  it("drops default ports (443/80)", () => {
    expect(canonicalizeBrowserUrl("https://example.com:443/a")).toBe(
      "https://example.com/a",
    );
    expect(canonicalizeBrowserUrl("http://example.com:80/a")).toBe(
      "http://example.com/a",
    );
  });

  it("keeps non-default ports", () => {
    expect(canonicalizeBrowserUrl("https://example.com:8443/a")).toBe(
      "https://example.com:8443/a",
    );
  });

  it("normalizes a bare origin to a trailing-slash path", () => {
    expect(canonicalizeBrowserUrl("https://example.com")).toBe(
      "https://example.com/",
    );
  });

  it("drops the fragment (same document)", () => {
    expect(canonicalizeBrowserUrl("https://example.com/a#section")).toBe(
      "https://example.com/a",
    );
    // Two fragments of the same page canonicalize identically → dedup.
    expect(canonicalizeBrowserUrl("https://example.com/a#x")).toBe(
      canonicalizeBrowserUrl("https://example.com/a#y"),
    );
  });

  it("preserves the query string", () => {
    expect(canonicalizeBrowserUrl("https://example.com/s?q=1&r=2")).toBe(
      "https://example.com/s?q=1&r=2",
    );
  });

  it("punycodes IDN hosts", () => {
    expect(canonicalizeBrowserUrl("https://ドメイン.example/x")).toBe(
      "https://xn--eckwd4c7c.example/x",
    );
  });

  it("strips a trailing dot on the host", () => {
    expect(canonicalizeBrowserUrl("https://example.com./a")).toBe(
      "https://example.com/a",
    );
  });

  it("returns null for non-http(s) schemes", () => {
    expect(canonicalizeBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(canonicalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeBrowserUrl("about:blank")).toBeNull();
    expect(canonicalizeBrowserUrl("data:text/html,x")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(canonicalizeBrowserUrl("")).toBeNull();
    expect(canonicalizeBrowserUrl("not a url")).toBeNull();
    expect(canonicalizeBrowserUrl("https://")).toBeNull();
  });

  it("returns null for empty-label hosts", () => {
    expect(canonicalizeBrowserUrl("https://.com/a")).toBeNull();
    expect(canonicalizeBrowserUrl("https://a..b.com/a")).toBeNull();
  });
});
