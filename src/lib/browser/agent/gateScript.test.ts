// WI-NB2.2 — the injected gate-signals script: title/text/url extraction and the
// attribute tier of the widget/password checks. jsdom has no layout, so the
// rendered-size checks self-disable here (attribute tier) and are exercised in
// gateScript.webkit.test.ts against real WebKit.
import { describe, it, expect } from "vitest";
import { buildGateSignalsScript } from "./gateScript";
import type { GateSignals } from "../gates";

function exec(doc: Document): GateSignals {
  const fn = new Function("document", "location", buildGateSignalsScript());
  return JSON.parse(fn(doc, { href: "https://x.example.com/p" }) as string) as GateSignals;
}

function parse(html: string, title = ""): Document {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  if (title) doc.title = title;
  return doc;
}

describe("buildGateSignalsScript", () => {
  it("extracts title, url, and the head of the visible text", () => {
    const s = exec(parse(`<main><h1>Welcome</h1><p>Some content here.</p></main>`, "Site — Home"));
    expect(s.title).toBe("Site — Home");
    expect(s.url).toContain("x.example.com");
    expect(s.textHead).toContain("Welcome");
    expect(s.textHead).toContain("Some content here.");
  });

  it("caps textHead at 4000 chars", () => {
    const s = exec(parse(`<p>${"x".repeat(9000)}</p>`));
    expect(s.textHead.length).toBeLessThanOrEqual(4000);
  });

  it("reports a password field (attribute tier: present and not attribute-hidden)", () => {
    const s = exec(parse(`<form><input type="password"></form>`));
    expect(s.passwordField).toBe(true);
  });

  it("does not report an attribute-hidden password field", () => {
    const s = exec(parse(`<div hidden><input type="password"></div>`));
    expect(s.passwordField).toBe(false);
  });

  it("does not report a challenge widget for a bare, unstyled iframe in jsdom (no layout = no size proof either way; attribute tier accepts it only if not hidden)", () => {
    const s = exec(parse(`<div hidden><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>`));
    expect(s.challengeWidget).toBe(false);
  });

  it("reports a non-hidden challenge frame at the attribute tier", () => {
    const s = exec(parse(`<iframe src="https://challenges.cloudflare.com/turnstile/v0/x" title="challenge"></iframe>`));
    expect(s.challengeWidget).toBe(true);
  });

  it("never throws on a bare document", () => {
    const s = exec(parse(``));
    expect(s).toMatchObject({ challengeWidget: false, passwordField: false });
  });
});
