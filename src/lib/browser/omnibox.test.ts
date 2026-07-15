// WI-S1.5 — omnibox: classify an address-bar entry as a URL to navigate or a search query
import { describe, it, expect } from "vitest";
import { resolveOmnibox, navigationTarget } from "./omnibox";

describe("navigationTarget", () => {
  it("canonicalizes and preserves the fragment", () => {
    expect(navigationTarget("https://example.com/page#sec")).toBe("https://example.com/page#sec");
  });

  it("canonicalizes a plain http url (adds trailing slash)", () => {
    expect(navigationTarget("http://example.com")).toBe("http://example.com/");
  });

  it("falls back to the raw input for a non-navigable scheme", () => {
    expect(navigationTarget("about:blank")).toBe("about:blank");
  });
});

describe("resolveOmnibox — URLs", () => {
  it("passes an explicit https URL through, preserving the fragment", () => {
    expect(resolveOmnibox("https://example.com/page#sec")).toBe("https://example.com/page#sec");
  });

  it("keeps an explicit http scheme (does not upgrade)", () => {
    expect(resolveOmnibox("http://example.com")).toBe("http://example.com/");
  });

  it("prepends https to a bare domain", () => {
    expect(resolveOmnibox("example.com")).toBe("https://example.com/");
  });

  it("handles a bare host with a path", () => {
    expect(resolveOmnibox("sub.example.co.uk/path")).toBe("https://sub.example.co.uk/path");
  });

  it("uses http for localhost with a port (dev-friendly)", () => {
    expect(resolveOmnibox("localhost:3000")).toBe("http://localhost:3000/");
  });

  it("uses http for a loopback IP", () => {
    expect(resolveOmnibox("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
  });

  it("uses https for a non-loopback IP", () => {
    expect(resolveOmnibox("192.168.1.1")).toBe("https://192.168.1.1/");
  });
});

describe("resolveOmnibox — searches", () => {
  it("treats a multi-word phrase as a search", () => {
    expect(resolveOmnibox("hello world")).toBe("https://duckduckgo.com/?q=hello%20world");
  });

  it("treats a single dotless word as a search", () => {
    expect(resolveOmnibox("rust")).toBe("https://duckduckgo.com/?q=rust");
  });

  it("treats a dotted phrase with spaces as a search, not a URL", () => {
    expect(resolveOmnibox("example.com is down")).toBe(
      "https://duckduckgo.com/?q=example.com%20is%20down",
    );
  });

  it("encodes special characters in the query", () => {
    expect(resolveOmnibox("a & b?")).toBe("https://duckduckgo.com/?q=a%20%26%20b%3F");
  });
});

describe("resolveOmnibox — empty", () => {
  it("returns empty string for blank input", () => {
    expect(resolveOmnibox("   ")).toBe("");
    expect(resolveOmnibox("")).toBe("");
  });
});

// Audit finding (High): `/^127\./` matched `127.evil.com` — a registrable domain — and
// silently downgraded it from https to http. A prefix test on a hostname is not an IP test.
describe("resolveOmnibox — the loopback shortcut is an IP test, not a prefix test", () => {
  it("does NOT treat a domain that merely starts with 127. as loopback", () => {
    expect(resolveOmnibox("127.evil.com")).toBe("https://127.evil.com/");
    expect(resolveOmnibox("127.0.0.1.attacker.net")).toBe("https://127.0.0.1.attacker.net/");
  });

  it("still uses http for a real IPv4 loopback", () => {
    expect(resolveOmnibox("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
    expect(resolveOmnibox("127.1.2.3")).toBe("http://127.1.2.3/");
  });
});
