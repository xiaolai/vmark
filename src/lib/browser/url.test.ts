// WI-1.1 — browser URL canonicalization for tab dedup + persistence
import { describe, it, expect } from "vitest";
import { canonicalizeBrowserUrl, urlForAgent, urlForPersistence } from "./url";

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

  it("preserves userinfo — credentialed URLs for different users must not dedup together", () => {
    expect(canonicalizeBrowserUrl("https://alice:pw@example.com/x")).toBe(
      "https://alice:pw@example.com/x",
    );
    expect(canonicalizeBrowserUrl("https://alice@example.com/x")).not.toBe(
      canonicalizeBrowserUrl("https://bob@example.com/x"),
    );
    expect(canonicalizeBrowserUrl("https://alice@example.com/x")).not.toBe(
      canonicalizeBrowserUrl("https://example.com/x"),
    );
  });

  it("preserves an empty query delimiter (`/path?` is not `/path`)", () => {
    expect(canonicalizeBrowserUrl("https://example.com/path?")).toBe(
      "https://example.com/path?",
    );
    expect(canonicalizeBrowserUrl("https://example.com/?#frag")).toBe("https://example.com/?");
  });
});

// WI-S0.13 — what the AI is told the page is.
//
// `canonicalizeBrowserUrl` keeps userinfo on purpose: it is part of tab identity, and
// dropping it would navigate somewhere the user did not ask for. But the URL also crosses
// to the AI in the `read`/`act` responses — and embedded credentials are the one thing on a
// page the AI could not otherwise obtain by reading the DOM. That makes the URL a leak
// channel that the whole approval model does not otherwise open. (Audit, High.)
describe("urlForAgent — credentials never cross to the AI", () => {
  it("strips embedded credentials entirely — username as well as password", () => {
    // Both, not just the password: the username names an account, and the AI has no use
    // for it that reading the page would not already serve.
    expect(urlForAgent("https://alice:hunter2@example.com/x")).toBe("https://example.com/x");
    expect(urlForAgent("https://alice:hunter2@example.com/x")).not.toContain("hunter2");
    expect(urlForAgent("https://alice@example.com/x")).toBe("https://example.com/x");
  });

  it("keeps scheme/host/port/path for the AI to reason about where it is", () => {
    expect(urlForAgent("https://example.com/docs/42")).toBe("https://example.com/docs/42");
    expect(urlForAgent("https://example.com:8443/x")).toBe("https://example.com:8443/x");
  });

  // Security review P5 (Medium #3): query and fragment routinely carry secrets
  // (OAuth callbacks, magic links, implicit-flow access_token=…), so they are
  // stripped from the AI-facing URL — the earlier redaction removed userinfo only.
  it("strips the query string and fragment — they carry tokens the AI must not see", () => {
    expect(urlForAgent("https://service.example/callback?access_token=SECRET")).toBe(
      "https://service.example/callback",
    );
    expect(urlForAgent("https://service.example/callback?access_token=SECRET")).not.toContain(
      "SECRET",
    );
    expect(urlForAgent("https://example.com/x#access_token=SECRET")).toBe("https://example.com/x");
    expect(urlForAgent("https://example.com/docs/42?q=a&b=2#frag")).toBe(
      "https://example.com/docs/42",
    );
  });

  it("passes through a url it cannot parse rather than inventing one", () => {
    expect(urlForAgent("about:blank")).toBe("about:blank");
    expect(urlForAgent("")).toBe("");
  });
});

// WI-S0.14 — a browser tab's URL is written to disk (hot exit / session restore).
//
// `canonicalizeBrowserUrl` keeps userinfo deliberately: it is part of tab identity, and
// dropping it would restore a tab pointing somewhere the user did not ask for. But the same
// URL is persisted verbatim into the workspace config, so an embedded password ends up in a
// file on disk, in cleartext, outliving the session that had a reason for it. Bookmarks
// already refuse to keep it; session restore did not. (Audit, High.)
describe("urlForPersistence — a secret is not ours to write to disk", () => {
  it("strips an embedded password", () => {
    expect(urlForPersistence("https://alice:hunter2@example.com/x")).toBe(
      "https://alice@example.com/x",
    );
    expect(urlForPersistence("https://alice:hunter2@example.com/x")).not.toContain("hunter2");
  });

  it("KEEPS the username — it names the destination, and it is not a secret", () => {
    // Same call as bookmarks make: alice@host and bob@host are different places, so
    // dropping the username would restore the wrong one. A password is a credential; a
    // username is an address.
    expect(urlForPersistence("https://alice@example.com/x")).toBe("https://alice@example.com/x");
  });

  it("changes nothing about a url that carries no credential", () => {
    expect(urlForPersistence("https://example.com/docs/42?q=a#frag")).toBe(
      "https://example.com/docs/42?q=a#frag",
    );
  });

  it("passes an unparseable url through rather than inventing one", () => {
    expect(urlForPersistence("about:blank")).toBe("about:blank");
    expect(urlForPersistence("")).toBe("");
  });
});
