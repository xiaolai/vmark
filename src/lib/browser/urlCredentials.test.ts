// @vitest-environment node
// Audit R3 #783/#789 — the security vocabulary, split out of `url.ts`.
// `url.test.ts` exercises it through `urlForPersistence` (including the
// subset-of-the-recorder invariant); these pin the classifiers directly, so a
// vocabulary change fails at the rule rather than at one URL that used it.
import { describe, expect, it } from "vitest";
import { credentialPath, dropCredentialParams } from "./urlCredentials";

describe("credentialPath", () => {
  it.each([
    ["/reset/abc", "a flow word"],
    ["/password-reset/x", "a hyphenated compound"],
    ["/password_reset/x", "an underscored compound"],
    ["/magic-login/x", "magic-login"],
    ["/password%2Dreset/x", "a percent-encoded compound"],
    ["/a/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "a JWT segment"],
    ["/d/aB3xY9zQ7mN2pL5kR8tW", "a long opaque token segment"],
  ])("classifies %s as credential-bearing (%s)", (pathname) => {
    expect(credentialPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/docs/getting-started",
    "/2026/09/a-post-about-tokens-and-things",
    "/oauth",
    "/tokens",
  ])("leaves %s alone", (pathname) => {
    expect(credentialPath(pathname)).toBe(false);
  });

  it("treats an undecodable segment as a credential — this is a redactor", () => {
    // A malformed escape is not a shape an ordinary path takes, and guessing
    // wrong in the other direction writes a secret to disk.
    expect(credentialPath("/%E0%A4%A")).toBe(true);
  });
});

describe("dropCredentialParams", () => {
  it("deletes the credential names and reports that it did", () => {
    const params = new URLSearchParams("q=hello&access_token=abc&page=2");
    expect(dropCredentialParams(params)).toBe(true);
    expect(params.toString()).toBe("q=hello&page=2");
  });

  it("reports false and changes nothing when every name is an address", () => {
    const params = new URLSearchParams("q=hello&page=2&state=CA");
    expect(dropCredentialParams(params)).toBe(false);
    expect(params.toString()).toBe("q=hello&page=2&state=CA");
  });

  it("matches a name at BOTH boundaries — a dot opened one but did not close it", () => {
    // The boundary set is `^ _ - .` on each side, so `token.value` and
    // `x-token` are names while `mytoken`/`tokenish` are words that merely
    // contain one. Deliberate: a substring rule drops ordinary parameters.
    const params = new URLSearchParams("token.value=x&x-token=y&mytoken=z&tokenish=w");
    expect(dropCredentialParams(params)).toBe(true);
    expect(params.toString()).toBe("mytoken=z&tokenish=w");
  });

  it("splits a camelCase name at its case boundaries, acronym heads included", () => {
    const params = new URLSearchParams("accessToken=a&APIToken=b&sessionId=c&keep=d");
    expect(dropCredentialParams(params)).toBe(true);
    expect(params.toString()).toBe("keep=d");
  });
});
