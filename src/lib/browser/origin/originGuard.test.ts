// Security enforcement core for the embedded browser (R4 / I3 / R7a).
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
//
// These tests are the normative specification of origin canonicalization and
// grant matching. Codex round-1 D4-4 and round-2 flagged that a hand-wavy origin
// check is a security hole; this table is the contract.
import { describe, expect, it } from "vitest";
import {
  canonicalizeOrigin,
  originKey,
  originMatchesPattern,
  isOriginGranted,
  isOriginPattern,
  describeOriginPattern,
} from "./originGuard";

describe("canonicalizeOrigin", () => {
  it.each([
    // input, expected key (or null)
    ["https://example.com", "https://example.com:443"],
    ["http://example.com", "http://example.com:80"],
    ["https://example.com:443", "https://example.com:443"], // default port normalized
    ["http://example.com:80", "http://example.com:80"],
    ["https://example.com:8443", "https://example.com:8443"], // non-default kept
    ["HTTPS://Example.COM", "https://example.com:443"], // scheme + host lowercased
    ["https://example.com.", "https://example.com:443"], // trailing dot stripped
    ["https://example.com./", "https://example.com:443"],
    ["https://user:pass@example.com/path?q=1#frag", "https://example.com:443"], // userinfo/path/query/hash stripped
    ["https://例え.jp", "https://xn--r8jz45g.jp:443"], // IDN → punycode
    ["https://xn--r8jz45g.jp", "https://xn--r8jz45g.jp:443"], // already-punycode stable
  ])("canonicalizes %s → %s", (input, expected) => {
    const o = canonicalizeOrigin(input);
    expect(o).not.toBeNull();
    expect(originKey(o!)).toBe(expected);
  });

  it.each([
    ["about:blank"], // opaque
    ["data:text/html,<p>x</p>"], // opaque
    ["blob:https://example.com/uuid"], // opaque
    ["file:///etc/passwd"], // not a web origin
    ["ftp://example.com"], // not http(s)
    ["ws://example.com"], // request-surface scheme, not a navigable origin
    ["wss://example.com"],
    ["javascript:alert(1)"], // never
    [""], // empty
    ["not a url"],
    ["//example.com"], // schemeless
    ["https://"], // no host
    ["example.com"], // no scheme
    ["https://.."], // dot-only host (empty labels)
    ["https://.com"], // leading empty label
    ["https://a..b.com"], // interior empty label
  ])("rejects %s → null", (input) => {
    expect(canonicalizeOrigin(input)).toBeNull();
  });

  it("normalizes a Unicode ideographic full stop (U+3002) to an ASCII dot", () => {
    // 例え。jp uses the CJK 。 as a label separator; URL normalizes it.
    const o = canonicalizeOrigin("https://例え。jp");
    expect(o).not.toBeNull();
    expect(originKey(o!)).toBe("https://xn--r8jz45g.jp:443");
  });
});

describe("originMatchesPattern", () => {
  const target = (u: string) => canonicalizeOrigin(u)!;

  it("matches exact origin", () => {
    expect(originMatchesPattern(target("https://example.com"), "https://example.com")).toBe(true);
  });

  it("does NOT match a subdomain without an explicit wildcard (no implicit wildcarding)", () => {
    expect(originMatchesPattern(target("https://sub.example.com"), "https://example.com")).toBe(false);
  });

  it("matches a subdomain with an explicit wildcard", () => {
    expect(originMatchesPattern(target("https://sub.example.com"), "https://*.example.com")).toBe(true);
  });

  it("matches a deep subdomain with a wildcard (ends-with semantics)", () => {
    expect(originMatchesPattern(target("https://a.b.example.com"), "https://*.example.com")).toBe(true);
  });

  it("wildcard does NOT match the apex domain", () => {
    // *.example.com covers strict subdomains only — a common security convention.
    expect(originMatchesPattern(target("https://example.com"), "https://*.example.com")).toBe(false);
  });

  it("wildcard does NOT match a look-alike suffix", () => {
    // notexample.com must not match *.example.com
    expect(originMatchesPattern(target("https://notexample.com"), "https://*.example.com")).toBe(false);
    expect(originMatchesPattern(target("https://evil-example.com"), "https://*.example.com")).toBe(false);
  });

  it("enforces scheme match", () => {
    expect(originMatchesPattern(target("http://example.com"), "https://example.com")).toBe(false);
  });

  it("enforces port match (default-normalized)", () => {
    expect(originMatchesPattern(target("https://example.com"), "https://example.com:443")).toBe(true);
    expect(originMatchesPattern(target("https://example.com:8443"), "https://example.com")).toBe(false);
  });

  it("canonicalizes IDN on both sides", () => {
    expect(originMatchesPattern(target("https://例え.jp"), "https://xn--r8jz45g.jp")).toBe(true);
    expect(originMatchesPattern(target("https://例え.jp"), "https://例え.jp")).toBe(true);
  });

  it("returns false for an unparseable pattern rather than throwing", () => {
    expect(originMatchesPattern(target("https://example.com"), "not a pattern")).toBe(false);
    expect(originMatchesPattern(target("https://example.com"), "")).toBe(false);
  });

  it("returns false for a wildcard pattern with no registrable base", () => {
    // "https://*" or "https://*." is meaningless and must never match anything.
    expect(originMatchesPattern(target("https://example.com"), "https://*")).toBe(false);
    expect(originMatchesPattern(target("https://example.com"), "https://*.")).toBe(false);
  });

  it("SECURITY: a pattern with userinfo must not be reinterpreted into another authority", () => {
    // `https://*.example.com@evil.com` parses (via URL) with userinfo "example.com"
    // and host "evil.com". It must be REJECTED, never treated as granting *.evil.com.
    expect(originMatchesPattern(target("https://sub.evil.com"), "https://*.example.com@evil.com")).toBe(false);
    expect(originMatchesPattern(target("https://evil.com"), "https://example.com@evil.com")).toBe(false);
    expect(isOriginPattern("https://*.example.com@evil.com")).toBe(false);
    expect(isOriginPattern("https://example.com@evil.com")).toBe(false);
  });

  it("SECURITY: a pattern with a path, query, or fragment is rejected (must be a bare origin)", () => {
    expect(isOriginPattern("https://example.com/path")).toBe(false);
    expect(isOriginPattern("https://example.com?q=1")).toBe(false);
    expect(isOriginPattern("https://example.com#frag")).toBe(false);
    expect(isOriginPattern("https://*.example.com/admin")).toBe(false);
  });

  it("SECURITY: wildcard cannot be tricked by a suffix or embedded-authority target", () => {
    // classic confusables that must NOT match *.example.com
    expect(originMatchesPattern(target("https://example.com.evil.com"), "https://*.example.com")).toBe(false);
    expect(originMatchesPattern(target("https://xexample.com"), "https://*.example.com")).toBe(false);
  });
});

describe("isOriginPattern", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "https://example.com:8443",
    "https://*.example.com",
    "https://*.a.b.example.com",
  ])("accepts valid pattern %s", (p) => {
    expect(isOriginPattern(p)).toBe(true);
  });

  it.each([
    "not-a-url",
    "about:blank",
    "https://*", // bare wildcard host
    "https://*.", // wildcard with no base
    "https://", // no host
    "", // empty
    "ws://example.com", // non-navigable scheme
    "https://ex*ample.com", // stray wildcard mid-host
  ])("rejects invalid pattern %s", (p) => {
    expect(isOriginPattern(p)).toBe(false);
  });
});

describe("describeOriginPattern", () => {
  it("describes an exact pattern", () => {
    expect(describeOriginPattern("https://example.com")).toEqual({
      wildcard: false,
      scheme: "https",
      host: "example.com",
      port: 443,
    });
  });

  it("describes a wildcard pattern with its base host", () => {
    expect(describeOriginPattern("https://*.sub.example.com")).toEqual({
      wildcard: true,
      scheme: "https",
      host: "sub.example.com",
      port: 443,
    });
  });

  it("returns null for an invalid pattern (including userinfo tricks)", () => {
    expect(describeOriginPattern("https://*.example.com@evil.com")).toBeNull();
    expect(describeOriginPattern("not-a-url")).toBeNull();
  });
});

describe("isOriginGranted", () => {
  it("grants when any pattern in the grant set matches", () => {
    const grants = ["https://zhihu.com", "https://*.zhihu.com"];
    expect(isOriginGranted("https://zhuanlan.zhihu.com/p/1", grants)).toBe(true);
    expect(isOriginGranted("https://zhihu.com/question/1", grants)).toBe(true);
  });

  it("denies when no pattern matches", () => {
    const grants = ["https://*.zhihu.com"];
    expect(isOriginGranted("https://weibo.com", grants)).toBe(false);
  });

  it("denies an un-canonicalizable target (opaque/invalid) regardless of grants", () => {
    // A page that navigated to about:blank has no grantable origin (R7a).
    expect(isOriginGranted("about:blank", ["https://*.zhihu.com"])).toBe(false);
    expect(isOriginGranted("data:text/html,x", ["https://*"])).toBe(false);
  });

  it("denies against an empty grant set (default-deny)", () => {
    expect(isOriginGranted("https://example.com", [])).toBe(false);
  });
});
