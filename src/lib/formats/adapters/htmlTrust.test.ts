// @vitest-environment node
// Trusted-preview vocabulary (issue #1273).
//
// These assert the security-relevant strings DIRECTLY rather than through a
// rendered component, because that is the level at which they are decisions:
// `allow-scripts allow-same-origin` would defeat the whole design while still
// rendering a perfectly normal-looking preview.

import { describe, expect, it } from "vitest";
import {
  TRUSTED_ALLOW,
  TRUSTED_SANDBOX,
  TRUSTED_SCHEME,
  trustedFrameUrl,
} from "./htmlTrust";

const TOKEN = "0123456789abcdef".repeat(4);

describe("trusted frame capabilities", () => {
  /// The load-bearing assertion of the feature. `allow-same-origin` alongside
  /// `allow-scripts` lets the framed document reach the embedder and strip its
  /// own sandbox attribute.
  it("grants scripts and nothing else", () => {
    expect(TRUSTED_SANDBOX).toBe("allow-scripts");
  });

  it("never combines allow-scripts with allow-same-origin", () => {
    expect(TRUSTED_SANDBOX).not.toContain("allow-same-origin");
  });

  it.each([
    "allow-same-origin",
    "allow-top-navigation",
    "allow-top-navigation-by-user-activation",
    "allow-popups",
    "allow-popups-to-escape-sandbox",
    "allow-forms",
    "allow-downloads",
    "allow-modals",
    "allow-pointer-lock",
    "allow-presentation",
    "allow-orientation-lock",
  ])("does not grant %s", (token) => {
    expect(TRUSTED_SANDBOX.split(/\s+/)).not.toContain(token);
  });

  it("delegates no powerful feature through the allow attribute", () => {
    expect(TRUSTED_ALLOW).toBe("");
  });
});

describe("trustedFrameUrl", () => {
  it("addresses the document by token under the registered scheme", () => {
    expect(trustedFrameUrl(TOKEN)).toBe(`${TRUSTED_SCHEME}://doc/${TOKEN}`);
  });

  it("uses the scheme the Rust protocol registers", () => {
    expect(TRUSTED_SCHEME).toBe("vmark-trusted");
  });

  it("puts nothing after the token — the token is the only selector", () => {
    const url = trustedFrameUrl(TOKEN);
    expect(url.endsWith(TOKEN)).toBe(true);
  });

  it("never produces an http(s) URL", () => {
    expect(trustedFrameUrl(TOKEN)).not.toMatch(/^https?:/);
  });
});
