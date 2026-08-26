// @vitest-environment node
/**
 * The window-ready attribute is a contract between the app and the E2E harness,
 * and no compiler joins the two ends.
 *
 * `src/contexts/useWindowReady.ts` sets an attribute on `documentElement` once
 * a window has mounted its listeners; `e2e/lib/readiness.mjs` gates every CI
 * journey run on seeing it. They are joined by a STRING, evaluated as a DOM
 * query inside a live webview — so a rename on either side type-checks, lints
 * and ships, and the only symptom is that `wait-ready.mjs` waits out its full
 * five-minute budget and fails against an app that is perfectly healthy.
 *
 * That failure mode is why this file is a contract test and not a unit test:
 * the behaviour on each side is individually correct in every case where they
 * disagree.
 *
 * @coordinates-with src/contexts/useWindowReady.ts — sets the attribute
 * @coordinates-with e2e/lib/readiness.mjs — gates readiness on it
 * @module test/windowReadyContract
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const appSource = readFileSync("src/contexts/useWindowReady.ts", "utf8");
const harnessSource = readFileSync("e2e/lib/readiness.mjs", "utf8");

/** The single-quoted or double-quoted attribute literal each side declares. */
function declaredAttribute(source: string): string {
  const match = source.match(/READY_ATTRIBUTE = ["']([^"']+)["']/);
  if (!match) throw new Error("READY_ATTRIBUTE literal not found");
  return match[1];
}

describe("window-ready attribute contract", () => {
  it("is declared on both sides", () => {
    expect(declaredAttribute(appSource)).toBeTruthy();
    expect(declaredAttribute(harnessSource)).toBeTruthy();
  });

  it("agrees across the app and the harness", () => {
    expect(
      declaredAttribute(harnessSource),
      "the harness would poll for an attribute the app never sets, and every " +
        "CI journey run would wait out its budget against a healthy app",
    ).toBe(declaredAttribute(appSource));
  });

  it("has the probe INTERPOLATE the constant rather than repeat it", () => {
    // The probe is a STRING evaluated in the webview. It used to spell the
    // attribute out a second time, so the constant being right did not make
    // the query right — two literals that had to agree, with only this test
    // between them (audit finding #2). Interpolating removes the second
    // spelling entirely, which kills the drift instead of detecting it.
    expect(harnessSource).toContain("getAttribute('${READY_ATTRIBUTE}')");
    // And the literal must not come back alongside it.
    expect(
      harnessSource.includes(`getAttribute('${declaredAttribute(harnessSource)}')`),
      "the probe hardcodes the attribute again — interpolate READY_ATTRIBUTE instead",
    ).toBe(false);
  });

  it("is set by the app on the element the probe reads", () => {
    // `documentElement` on one side and `document.body` on the other would be
    // a permanent, silent false.
    expect(appSource).toMatch(/document\.documentElement\.setAttribute\(\s*READY_ATTRIBUTE/);
    expect(harnessSource).toContain("document.documentElement.getAttribute(");
  });

  it("is published AFTER the ready emit, never before it", () => {
    // The attribute's whole value is that it is not true earlier than the fact
    // it reports. Hoisting it above the emit would reintroduce a proxy.
    const emitIndex = appSource.indexOf('w.emit("ready"');
    const setIndex = appSource.indexOf("setAttribute(READY_ATTRIBUTE");
    expect(emitIndex).toBeGreaterThan(-1);
    expect(setIndex).toBeGreaterThan(emitIndex);
  });

  it("does not gate readiness on an open document", () => {
    // A fresh profile boots to the welcome screen: no editor, no tabs. Gating
    // on either makes a healthy first launch look permanently unready, which
    // is exactly what a CI runner starts from.
    expect(harnessSource).not.toContain(".ProseMirror");
    expect(harnessSource).not.toContain("data-tab-id");
  });
});
