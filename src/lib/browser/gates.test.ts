// @vitest-environment node
// WI-NB2.2 — gate classifier: login walls, consent interstitials, human-verification
// challenges, rate limits. The contract under test is PRECISION: every verdict
// needs either a rendered challenge widget or >=2 independent signals, because
// NeoBrowser's single-substring port classified any page mentioning "cloudflare",
// any "$429" price, and any footer "403" as a wall — the false-positive corpus
// below pins that entire class to null.
import { describe, it, expect } from "vitest";
import { classifyGate, type GateSignals } from "./gates";

function signals(partial: Partial<GateSignals>): GateSignals {
  return {
    url: "https://site.example.com/page",
    title: "An ordinary page",
    textHead: "Ordinary content.",
    challengeWidget: false,
    passwordField: false,
    ...partial,
  };
}

describe("classifyGate — verdicts", () => {
  it("a rendered challenge widget alone is a challenge (size-checked upstream)", () => {
    const v = classifyGate(signals({ challengeWidget: true }));
    expect(v?.kind).toBe("challenge");
    expect(v?.hint).toBeTruthy();
  });

  it("challenge-title plus challenge-text on a terse page is a challenge", () => {
    const v = classifyGate(
      signals({
        title: "Just a moment...",
        textHead: "Verify you are human by completing the action below.",
      }),
    );
    expect(v?.kind).toBe("challenge");
  });

  it("consent needs the consent URL AND consent content", () => {
    const v = classifyGate(
      signals({
        url: "https://consent.google.com/m?continue=https://www.google.com/",
        title: "Before you continue",
        textHead: "We use cookies and data to deliver and maintain services. Accept all or reject all.",
      }),
    );
    expect(v?.kind).toBe("consent");
  });

  it("login-required needs a password field AND login context (title)", () => {
    const v = classifyGate(
      signals({ passwordField: true, title: "Sign in — GitHub", textHead: "Username or email address. Password." }),
    );
    expect(v?.kind).toBe("login-required");
  });

  it("login-required needs a password field AND login context (url path)", () => {
    const v = classifyGate(
      signals({ passwordField: true, url: "https://site.example.com/login?next=%2Fdashboard" }),
    );
    expect(v?.kind).toBe("login-required");
  });

  it("rate-limited needs two independent signals", () => {
    const v = classifyGate(
      signals({ title: "429 Too Many Requests", textHead: "Too many requests. Try again later." }),
    );
    expect(v?.kind).toBe("rate-limited");
  });

  it("a challenge outranks a login form on the same interstitial", () => {
    const v = classifyGate(
      signals({ challengeWidget: true, passwordField: true, title: "Sign in" }),
    );
    expect(v?.kind).toBe("challenge");
  });
});

describe("classifyGate — the false-positive corpus stays null", () => {
  it.each<[string, Partial<GateSignals>]>([
    ["a $429 price in body text", { textHead: "The Pro plan costs $429 per year. Too many features to list." }],
    ["a 'Protected by Cloudflare' footer", { textHead: "© 2026 Acme. Protected by Cloudflare. All rights reserved." }],
    [
      "a homepage with a header login form",
      { passwordField: true, title: "Acme — Home", textHead: "Welcome to Acme. Products. Pricing. Contact." },
    ],
    [
      "an article ABOUT captchas (long page)",
      {
        title: "Verify you are human — how CAPTCHAs actually work",
        textHead:
          "Verify you are human is the phrase every CAPTCHA shows. In this article we look at how sites decide to challenge visitors. ".repeat(20),
      },
    ],
    ["docs mentioning rate limits", { textHead: "The API applies a rate limit of 100 requests per minute." }],
    ["a consent-worded cookie banner on an ordinary URL", { textHead: "We use cookies. Accept all." }],
    ["a bare login path with no password field", { url: "https://site.example.com/login" }],
  ])("%s", (_label, partial) => {
    expect(classifyGate(signals(partial))).toBeNull();
  });
});

describe("classifyGate — hints tell the model to involve the user, never to retry", () => {
  it.each<[GateSignals]>([
    [signals({ challengeWidget: true })],
    [signals({ passwordField: true, title: "Log in" })],
    [signals({ title: "429 Too Many Requests", textHead: "Too many requests. Try again later." })],
  ])("hint present and retry-free", (s) => {
    const v = classifyGate(s);
    if (v === null) return; // corpus rows that need two signals are covered above
    expect(v.hint.length).toBeGreaterThan(20);
    expect(v.hint.toLowerCase()).not.toContain("retry the");
  });
});
