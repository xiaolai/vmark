// @vitest-environment node
// Trusted-preview vocabulary (issue #1273; Windows form WI-FL6.5).
//
// These assert the security-relevant strings DIRECTLY rather than through a
// rendered component, because that is the level at which they are decisions:
// `allow-scripts allow-same-origin` would defeat the whole design while still
// rendering a perfectly normal-looking preview.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRUSTED_ALLOW,
  TRUSTED_SANDBOX,
  TRUSTED_SCHEME,
  TRUSTED_WINDOWS_ORIGIN,
  trustedFrameUrl,
  trustedFrameUrlFor,
} from "./htmlTrust";

const TOKEN = "0123456789abcdef".repeat(4);
const SCHEME_FORM = `${TRUSTED_SCHEME}://doc/${TOKEN}`;
const WINDOWS_FORM = `${TRUSTED_WINDOWS_ORIGIN}/${TOKEN}`;
const CONFIG = new URL("../../../../src-tauri/tauri.conf.json", import.meta.url);

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

describe("trustedFrameUrlFor — one URL form per platform", () => {
  it("uses the scheme the Rust protocol registers", () => {
    expect(TRUSTED_SCHEME).toBe("vmark-trusted");
  });

  it.each([
    ["macos", SCHEME_FORM],
    ["linux", SCHEME_FORM],
    ["windows", WINDOWS_FORM],
  ] as const)("%s → %s", (platform, url) => {
    expect(trustedFrameUrlFor(TOKEN, platform)).toBe(url);
  });

  /// WebView2 has no custom schemes: wry serves a registered protocol at
  /// `http://<scheme>.<host>/…` and reverts that prefix to `<scheme>://` before
  /// the handler runs (wry 0.55.1 `custom_protocol_workaround.rs`). The origin is
  /// DERIVED from the scheme, so the contract gate's scheme pin covers it too.
  it("the Windows origin is the http workaround form of the registered scheme", () => {
    expect(TRUSTED_WINDOWS_ORIGIN).toBe(`http://${TRUSTED_SCHEME}.localhost`);
  });

  it("the Windows form reverts to the scheme form the Rust handler resolves", () => {
    const reverted = WINDOWS_FORM.replace(`http://${TRUSTED_SCHEME}.`, `${TRUSTED_SCHEME}://`);
    expect(reverted).toBe(`${TRUSTED_SCHEME}://localhost/${TOKEN}`);
  });

  it.each(["macos", "linux", "windows"] as const)(
    "on %s the token is the only selector — nothing follows it",
    (platform) => {
      expect(trustedFrameUrlFor(TOKEN, platform).endsWith(`/${TOKEN}`)).toBe(true);
    },
  );

  it("the scheme form never becomes an http(s) URL", () => {
    expect(SCHEME_FORM).not.toMatch(/^https?:/);
  });

  // Audit 20260907 (#399): the token is interpolated into a path, so it must be
  // ONE path segment whatever it contains. A real token is 64 hex chars and
  // encodes to itself; anything else must not be able to add a segment, a
  // query or a fragment to the URL the frame loads.
  it.each(["macos", "linux", "windows"] as const)(
    "on %s the token is encoded as one path segment",
    (platform) => {
      const url = trustedFrameUrlFor("a/b?c#d", platform);
      expect(url.endsWith("/a%2Fb%3Fc%23d")).toBe(true);
      expect(new URL(url).pathname.split("/").filter(Boolean)).toEqual(["a%2Fb%3Fc%23d"]);
    },
  );

  it("a well-formed hex token encodes to itself", () => {
    expect(trustedFrameUrlFor(TOKEN, "macos")).toBe(SCHEME_FORM);
  });
});

describe("trustedFrameUrl — the form for the running platform", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["MacIntel", SCHEME_FORM],
    ["Linux x86_64", SCHEME_FORM],
    ["Win32", WINDOWS_FORM],
  ])("navigator.platform %s → %s", (platform, url) => {
    vi.stubGlobal("navigator", { platform });
    expect(trustedFrameUrl(TOKEN)).toBe(url);
  });
});

/// The app cannot embed a frame its own CSP forbids, and a wider `frame-src` is
/// a security decision: the directive must name the two trusted origins and
/// nothing beyond `'self'`.
describe("the app CSP allows exactly the trusted origins", () => {
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const csp: string = config.app.security.csp;
  const frameSrc = (/(?:^|;)\s*frame-src\s+([^;]+)/.exec(csp)?.[1] ?? "").trim().split(/\s+/);

  it("frame-src names the scheme (macOS/Linux) and the Windows origin", () => {
    expect(frameSrc).toContain(`${TRUSTED_SCHEME}:`);
    expect(frameSrc).toContain(TRUSTED_WINDOWS_ORIGIN);
  });

  it("and nothing else beyond 'self'", () => {
    expect([...frameSrc].sort()).toEqual(["'self'", `${TRUSTED_SCHEME}:`, TRUSTED_WINDOWS_ORIGIN].sort());
  });

  /// `useHttpsScheme` would move every custom protocol on Windows to
  /// `https://<scheme>.localhost`, so the origin here, the CSP and this test
  /// would all have to change together. Pin the assumption, not just the value.
  it("no window opts into useHttpsScheme", () => {
    const windows: Array<Record<string, unknown>> = config.app.windows;
    expect(Array.isArray(windows) && windows.length > 0).toBe(true);
    for (const window of windows) expect(window.useHttpsScheme ?? false).toBe(false);
  });
});

// Audit 20260907 round 3 (#792). The header calls the token "64 hex chars" and
// this builder accepts any string — so the question is where that contract is
// actually ENFORCED. It is enforced in Rust, at the only place that can act on
// it: `token_of` in `src-tauri/src/trusted_html/protocol.rs` refuses anything
// that is not exactly `TOKEN_LEN` ASCII-hex characters and the handler answers
// 404. Failing closed HERE instead would mean throwing out of a pure function
// that `HtmlPreview` calls during render, which the root error boundary turns
// into a lost window — trading an empty frame for a dead one.
//
// What that reasoning depends on is that the two sides agree about the token,
// and nothing in either language checks it. These do.
describe("the token contract is one contract, in two languages", () => {
  const protocol = readFileSync("src-tauri/src/trusted_html/protocol.rs", "utf8");

  it("the Rust handler refuses anything but a fixed-length hex token", () => {
    expect(protocol).toMatch(/path\.len\(\)\s*!=\s*TOKEN_LEN/);
    expect(protocol).toMatch(/is_ascii_hexdigit/);
  });

  it("the length this file's fixtures use is the length Rust requires", () => {
    const declared = /const TOKEN_LEN: usize = (\d+);/.exec(protocol)?.[1];
    expect(declared).toBeDefined();
    expect(TOKEN).toHaveLength(Number(declared));
  });

  it("a well-formed token survives the URL build unchanged, so Rust sees it whole", () => {
    for (const platform of ["macos", "linux", "windows"] as const) {
      const url = new URL(trustedFrameUrlFor(TOKEN, platform));
      expect(url.pathname.split("/").filter(Boolean)).toEqual([TOKEN]);
    }
  });
});
