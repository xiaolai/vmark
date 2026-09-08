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
import RECORDER_SENSITIVITY_SRC from "./agent/recorderShimSensitivity.src.js?raw";

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

  // Audit 20260907 (#397): an input the parser refuses used to be returned
  // verbatim — with whatever credential it carried. The redactor fails closed:
  // nothing is written, and restore drops the empty record as malformed.
  it("writes nothing for an input that will not parse — it may still carry a credential", () => {
    expect(urlForPersistence("https://alice:hunter2@exa mple.com/x")).toBe("");
    expect(urlForPersistence("not a url at all")).toBe("");
    expect(urlForPersistence("")).toBe("");
  });

  it("a parseable but non-web url is kept as it is — it carries nothing to redact", () => {
    expect(urlForPersistence("about:blank")).toBe("about:blank");
    expect(urlForPersistence("about:srcdoc")).toBe("about:srcdoc");
  });

  // Audit 20260907 round 2: "parseable" was the whole test, so every opaque
  // scheme went to disk verbatim — a `data:` URL keeps its ENTIRE payload in
  // what `URL` calls the path, and a `file:` URL a local path. The same rule
  // `urlForAgent` already applies one function up: http(s) or nothing.
  it.each([
    "data:text/html,<script>const token='hunter2'</script>",
    "file:///Users/me/private/notes.md",
    "blob:https://a.example/2b7c-secret",
    "about:settings#token=abc",
    "javascript:fetch('/steal')",
  ])("writes nothing for the non-navigable %s", (url) => {
    expect(urlForPersistence(url)).toBe("");
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

  // Audit 20260907 round 2 — three ways a credential walked past the redactor.
  it("drops an SPA fragment ROUTE that carries a credential, like the path rule", () => {
    // `#/reset/<token>` is the hash-router spelling of the path form above, and
    // nothing ran it through `credentialPath`, so it persisted intact.
    expect(urlForPersistence("https://a.example/app#/reset/9f8a7b6c5d4e3f2a1b0c")).toBe(
      "https://a.example/app",
    );
    expect(urlForPersistence("https://a.example/app#!/magic-login/abc123def456ghi789")).toBe(
      "https://a.example/app",
    );
    expect(urlForPersistence("https://a.example/app#/callback?code=x")).toBe("https://a.example/app");
  });

  it("keeps an ordinary hash route and a plain anchor", () => {
    for (const url of [
      "https://a.example/app#/settings/profile",
      "https://a.example/docs#installation",
    ]) {
      expect(urlForPersistence(url)).toBe(url);
    }
  });

  it("splits an ACRONYM-headed camelCase parameter name", () => {
    // `APIToken` and `JWTToken` have no lowercase→uppercase boundary, so the
    // one split rule left them a single word and the list never matched.
    expect(urlForPersistence("https://a.example/x?APIToken=abc&keep=1")).toBe(
      "https://a.example/x?keep=1",
    );
    expect(urlForPersistence("https://a.example/x?JWTToken=abc&keep=1")).toBe(
      "https://a.example/x?keep=1",
    );
    expect(urlForPersistence("https://a.example/x?accessToken=abc&keep=1")).toBe(
      "https://a.example/x?keep=1",
    );
  });

  it("treats a dot as a boundary on BOTH sides of a parameter name", () => {
    // The pattern let a dot OPEN a name but not close one.
    expect(urlForPersistence("https://a.example/x?token.value=abc&keep=1")).toBe(
      "https://a.example/x?keep=1",
    );
    expect(urlForPersistence("https://a.example/x?access_token.value=abc&keep=1")).toBe(
      "https://a.example/x?keep=1",
    );
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

// WI-FL6.4 — the recorder residual "recorded URL paths keep `/reset/<token>`". The
// flow-word rule matched a whole segment, so every compound spelling a real site
// uses went through; and a JWT's dots keep it out of the token-shape rule.
describe("credentialPath — compound flow spellings and JWTs (WI-FL6.4)", () => {
  it.each([
    "/password-reset/abc", // Discourse
    "/password_reset/abc", // GitHub
    "/reset_password/abc",
    "/verify-email/abc",
    "/confirm_email/abc",
    "/magic_link/abc",
    "/users/password/reset/abc",
  ])("%s names a credential flow", (path) => {
    expect(credentialPath(path)).toBe(true);
  });

  it("a JWT is a credential under any word — its dots defeat the token-shape rule", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(credentialPath(`/session/${jwt}`)).toBe(true);
    expect(urlForPersistence(`https://a.example/session/${jwt}`)).toBe("https://a.example/");
  });

  it.each([
    "/authors/jane", // `authors` is not `auth`
    "/tokens", // `tokens` is not `token`
    "/oauth-guide", // `oauth` is not `auth`
    "/resettlement/policy",
    "/archive/backup-2026-09-07.tar.gz",
  ])("%s is an ordinary path", (path) => {
    expect(credentialPath(path)).toBe(false);
  });
});

// Audit 20260907 (#395/#396/#398) — three shapes the persistence redactor let
// through: an SPA fragment route carrying its own query, camelCase parameter
// names, and percent-encoded flow words in the path.
describe("urlForPersistence — SPA fragment routes carry their own query (#395)", () => {
  it("drops the credential from the fragment's query and keeps the route", () => {
    expect(urlForPersistence("https://a.example/app#/dashboard?token=abc&state=x")).toBe(
      "https://a.example/app#/dashboard?state=x",
    );
    expect(urlForPersistence("https://a.example/app#/dashboard?access_token=abc&state=x")).toBe(
      "https://a.example/app#/dashboard?state=x",
    );
  });

  it("keeps the bare route when every fragment parameter was a credential", () => {
    expect(urlForPersistence("https://a.example/app#/dashboard?code=abc")).toBe(
      "https://a.example/app#/dashboard",
    );
  });

  // Round 2: a route that is itself a credential-bearing FLOW goes entirely,
  // not just its parameters. `credentialPath` is the shared classifier, and
  // applying it to `/callback` in the path but not to `#/callback` was the
  // drift it exists to prevent.
  it("drops a flow ROUTE whole, exactly as the path form is dropped", () => {
    expect(urlForPersistence("https://a.example/app#/callback?token=abc&state=x")).toBe(
      "https://a.example/app",
    );
    expect(urlForPersistence("https://a.example/callback?token=abc&state=x")).toBe(
      "https://a.example/",
    );
  });

  it("leaves a route with a harmless query alone", () => {
    const url = "https://a.example/app#/search?q=cats&page=2";
    expect(urlForPersistence(url)).toBe(url);
  });
});

describe("urlForPersistence — camelCase credential names (#396)", () => {
  it.each(["accessToken", "refreshToken", "idToken", "sessionId", "apiKey", "authToken"])(
    "drops %s from the query",
    (name) => {
      expect(urlForPersistence(`https://a.example/inbox?${name}=abc&page=2`)).toBe(
        "https://a.example/inbox?page=2",
      );
    },
  );

  it("drops a camelCase name from the fragment too", () => {
    expect(urlForPersistence("https://a.example/#accessToken=abc&expires=3600")).toBe(
      "https://a.example/#expires=3600",
    );
  });

  it("keeps camelCase names that are not credentials", () => {
    const url = "https://a.example/list?pageSize=20&sortOrder=asc";
    expect(urlForPersistence(url)).toBe(url);
  });
});

describe("credentialPath — percent-encoded segments are decoded first (#398)", () => {
  it.each(["/password%2Dreset/abc", "/%72eset/abc", "/verify%5Femail/abc"])(
    "%s names a credential flow once decoded",
    (path) => {
      expect(credentialPath(path)).toBe(true);
    },
  );

  it("the persisted form is the origin only", () => {
    expect(urlForPersistence("https://a.example/password%2Dreset/abc")).toBe("https://a.example/");
  });

  it("a segment that will not decode is treated as a credential (fail closed)", () => {
    expect(credentialPath("/docs/%zz-report")).toBe(true);
  });

  it("an encoded ordinary path stays ordinary", () => {
    expect(credentialPath("/docs/getting%20started")).toBe(false);
  });
});

// Audit R3 #789: the persistence redactor's parameter vocabulary and the
// recorder shim's field-sensitivity vocabulary were written independently and
// had drifted — `pin`, `passcode`, `cvv`, `ssn`, `pwd`, `passphrase`, `totp`,
// `mfa` and `2fa` name a secret to the recorder and named nothing here. Both
// guard the SAME thing: a secret reaching a file that outlives the session.
//
// The invariant is a one-way subset, and that direction is the whole point: a
// form field the recorder calls sensitive posts under that name, so persistence
// must be AT LEAST as strict. The reverse does not hold — `jsessionid` and
// `sid` are cookie-shaped names no form field carries.
describe("urlForPersistence — the recorder's secret vocabulary is a subset of this one", () => {
  const tokens = [
    ...RECORDER_SENSITIVITY_SRC.matchAll(/var SENSITIVE_TOKENS = \[([^\]]*)\]/g),
  ]
    .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)])
    .map((m) => m[1]);

  it("reads a non-empty token list out of the shim (the test itself must not go quiet)", () => {
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens).toContain("password");
  });

  it.each(tokens)(
    "drops ?%s= from a persisted URL",
    (token) => {
      const url = `https://example.com/p?${token}=SECRET&q=keep`;
      const persisted = urlForPersistence(url);
      expect(persisted).not.toContain("SECRET");
      expect(persisted).toContain("q=keep");
    },
  );
});

describe("urlForPersistence — parameter names added by review, not by pattern", () => {
  it.each(["csrf", "credential", "pin", "passcode", "cvv", "ssn"])(
    "drops ?%s=",
    (name) => {
      expect(urlForPersistence(`https://e.com/p?${name}=X1`)).not.toContain("X1");
    },
  );

  it("KEEPS ?state= — it is an ordinary address parameter far more often than a CSRF nonce", () => {
    // The audit proposed adding `state`. A store locator's `?state=CA` and a
    // filter's `?state=open` are the common case; dropping it would restore the
    // wrong page on every one of them, which is a real cost against a nonce
    // that is worthless once the flow completed.
    expect(urlForPersistence("https://e.com/stores?state=CA")).toBe(
      "https://e.com/stores?state=CA",
    );
  });
});
