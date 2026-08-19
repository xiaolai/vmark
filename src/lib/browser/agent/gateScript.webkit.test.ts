// WI-NB2.2 — gate signals, rendered tier (real WebKit): the visible-widget guard
// is a layout fact jsdom cannot test. An invisible or tiny challenge frame (the
// reCAPTCHA-v3 / managed-Turnstile shape on ordinary checkouts) must NOT read as
// a challenge; an interactive-size one must.
import { describe, it, expect, beforeEach } from "vitest";
import { buildGateSignalsScript } from "./gateScript";
import type { GateSignals } from "../gates";

function exec(): GateSignals {
  const fn = new Function("document", "location", buildGateSignalsScript());
  return JSON.parse(fn(document, window.location) as string) as GateSignals;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("challenge widget — the visible-size guard", () => {
  it("an interactive-size challenge frame is a widget", () => {
    document.body.innerHTML = `<iframe src="https://www.google.com/recaptcha/api2/anchor?x" style="width:304px;height:78px;border:0"></iframe>`;
    expect(exec().challengeWidget).toBe(true);
  });

  it("a 1x1 hidden score-captcha frame is NOT a widget", () => {
    document.body.innerHTML = `<iframe src="https://www.google.com/recaptcha/api2/anchor?x" style="width:1px;height:1px;visibility:hidden"></iframe>`;
    expect(exec().challengeWidget).toBe(false);
  });

  it("a display:none turnstile container is NOT a widget", () => {
    document.body.innerHTML = `<div class="cf-turnstile" style="display:none;width:300px;height:65px"></div>`;
    expect(exec().challengeWidget).toBe(false);
  });

  it("a sub-threshold (40x40) frame is NOT a widget", () => {
    document.body.innerHTML = `<iframe src="https://challenges.cloudflare.com/turnstile/v0/x" style="width:40px;height:40px;border:0"></iframe>`;
    expect(exec().challengeWidget).toBe(false);
  });
});

describe("password field — rendered tier", () => {
  it("a rendered login field is reported", () => {
    document.body.innerHTML = `<form><input type="password" style="width:200px;height:28px"></form>`;
    expect(exec().passwordField).toBe(true);
  });

  it("a zero-size (stylesheet-collapsed) password field is not", () => {
    document.body.innerHTML = `<style>.gone{display:none}</style><form class="gone"><input type="password"></form>`;
    expect(exec().passwordField).toBe(false);
  });
});
