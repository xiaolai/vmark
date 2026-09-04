// @vitest-environment node
// WI-1.1 — browser URL canonicalization for tab dedup + persistence
import { describe, it, expect } from "vitest";
import {
  canonicalizeBrowserUrl,
  urlForAgent,
  urlForPersistence,
  originForAgent,
  hostLabel,
  parseNavigableUrl,
  credentialPath,
} from "./url";

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

  it("fails closed on a url it cannot parse — a placeholder, never the raw value", () => {
    // The raw value can itself carry a credential; `about:` pages carry nothing.
    expect(urlForAgent("about:blank")).toBe("about:blank");
    expect(urlForAgent("")).toBe("(unparseable url)");
  });
});

// Security review P6 (High): a pre-authorization approval envelope must expose the
// ORIGIN only — even the path can carry a token (`/magic-login/<token>`).
describe("originForAgent — origin only, for approval envelopes", () => {
  it("keeps scheme/host/port but drops path, query, fragment, and userinfo", () => {
    expect(originForAgent("https://example.com/magic-login/SECRET?t=1#f")).toBe("https://example.com");
    expect(originForAgent("https://example.com/magic-login/SECRET")).not.toContain("SECRET");
    expect(originForAgent("https://example.com:8443/x")).toBe("https://example.com:8443");
    expect(originForAgent("https://alice:pw@example.com/x")).toBe("https://example.com");
  });

  it("fails closed for an opaque origin — scheme only, never the payload", () => {
    // A data: URL carries its payload in the "path"; only the scheme may show.
    expect(originForAgent("data:text/html,<h1>SECRET</h1>")).toBe("data:(opaque)");
    expect(originForAgent("data:text/html,<h1>SECRET</h1>")).not.toContain("SECRET");
    expect(originForAgent("about:blank")).toBe("about:(opaque)");
    expect(originForAgent("")).toBe("(unknown origin)");
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

describe("hostLabel", () => {
  it("names the host, keeping a non-default port", () => {
    expect(hostLabel("http://127.0.0.1:59180/second?x=1#f")).toBe("127.0.0.1:59180");
    expect(hostLabel("https://Example.com/path")).toBe("example.com");
  });

  it("falls back to the input when it is not a URL", () => {
    expect(hostLabel("not a url")).toBe("not a url");
    expect(hostLabel("")).toBe("");
  });
});

describe("urlForAgent fails closed", () => {
  it("never hands the model an unparseable value or an opaque payload", () => {
    expect(urlForAgent("not a url")).toBe("(unparseable url)");
    expect(urlForAgent("data:text/html,<script>secret</script>")).toBe("data:(opaque)");
    // A blob URL has its creator's origin and no payload; about: pages carry nothing.
    expect(urlForAgent("blob:https://a.example/uuid")).toBe("blob:https://a.example/uuid");
    expect(urlForAgent("about:blank")).toBe("about:blank");
  });
});

describe("urlForPersistence drops credential-bearing parameters", () => {
  it("removes token-like query and fragment parameters but keeps the rest", () => {
    expect(urlForPersistence("https://a.example/cb?access_token=abc&state=x&q=hello")).toBe(
      "https://a.example/cb?state=x&q=hello",
    );
    expect(urlForPersistence("https://a.example/#access_token=abc&expires=3600")).toBe(
      "https://a.example/#expires=3600",
    );
    // `/reset` is a credential-bearing FLOW path (round 3): the whole URL is kept as
    // its origin, the same rule the workflow recorder applies.
    expect(urlForPersistence("https://a.example/reset?token=t&user_password=p")).toBe("https://a.example/");
    expect(urlForPersistence("https://a.example/account/settings?token=t&tab=2")).toBe("https://a.example/account/settings?tab=2");
  });

  it("returns the input unchanged when nothing credential-like is present", () => {
    const url = "https://a.example/search?q=vmark&page=2#results";
    expect(urlForPersistence(url)).toBe(url);
  });
  it("shows only about:blank and about:srcdoc; any other about: payload is opaque (#129)", () => {
    expect(urlForAgent("about:srcdoc")).toBe("about:srcdoc");
    expect(urlForAgent("about:settings#secret")).toBe("about:(opaque)");
    expect(urlForAgent("about:blank?x=token")).toBe("about:blank");
  });
});

describe("parseNavigableUrl — the one parser (round 3)", () => {
  it("normalises the host and refuses what is not a navigable web URL", () => {
    expect(parseNavigableUrl("HTTPS://Example.COM./p")?.href).toBe("https://example.com/p");
    expect(parseNavigableUrl("https://[::1]:8443/x")?.hostname).toBe("[::1]");
    expect(parseNavigableUrl("https://a..b.com/")).toBeNull();
    expect(parseNavigableUrl("https://.com/")).toBeNull();
    expect(parseNavigableUrl("javascript:alert(1)")).toBeNull();
    expect(parseNavigableUrl("file:///etc/passwd")).toBeNull();
    expect(parseNavigableUrl("not a url")).toBeNull();
  });
});

describe("credential-bearing paths and session parameters never reach disk (round 3)", () => {
  it.each([
    "https://a.example/reset/abc",
    "https://a.example/magic-login/x",
    "https://a.example/invite/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
    "https://a.example/auth/callback",
  ])("%s persists as its origin only", (url) => {
    expect(credentialPath(new URL(url).pathname)).toBe(true);
    expect(urlForPersistence(url)).toBe("https://a.example/");
  });
  it("an ordinary path keeps its query, minus session ids and OAuth verifiers", () => {
    expect(credentialPath("/blog/2026/09/post-title")).toBe(false);
    expect(urlForPersistence("https://a.example/search?q=cats&sid=abc&JSESSIONID=1&oauth_verifier=v&page=2")).toBe(
      "https://a.example/search?q=cats&page=2",
    );
  });
});
