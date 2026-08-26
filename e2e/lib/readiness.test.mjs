// Regression cover for the readiness predicate that gates every Tier-0 journey.
//
// The case that matters is `refuses a webview that evaluates JS but has not
// booted`: that snapshot is EXACTLY what the old `execute_js "1+1"` probe saw
// when it declared run 32701401717 ready, six seconds before the app finished
// starting. Any change that lets it pass reopens the failure this file exists
// to keep closed.

import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";
import { DRIVABLE_SNIPPET, READY_ATTRIBUTE, drivableGap } from "./readiness.mjs";

/**
 * Evaluate the probe the way the bridge does — as an expression, against a
 * supplied `document`/`window` — so a syntax error in the snippet fails HERE
 * rather than surfacing in CI as an opaque five-minute timeout.
 *
 * `node:vm` rather than `new Function`: the snippet is evaluated in a context
 * of its own with nothing but the two globals it is handed.
 */
function evaluateSnippet({ document, window }) {
  return runInNewContext(`(${DRIVABLE_SNIPPET})`, { document, window });
}

/** A snapshot of a fully-booted app; each test degrades one field. */
const BOOTED = Object.freeze({
  tauriEmit: true,
  tauriInvoke: true,
  appShell: true,
  windowReady: true,
});

describe("drivableGap", () => {
  it("passes a fully booted app", () => {
    expect(drivableGap(BOOTED)).toBeNull();
  });

  it("refuses a webview that evaluates JS but has not booted", () => {
    // The regression: a JS context exists (the probe returned an object at
    // all), yet nothing the journeys drive is present.
    const gap = drivableGap({
      tauriEmit: false,
      tauriInvoke: false,
      appShell: false,
      windowReady: false,
    });
    expect(gap).not.toBeNull();
    expect(gap).toContain("invoke");
  });

  it("refuses a mounted app whose listeners are not registered yet", () => {
    // The precise shape of the CI failure: the shell is up, so every weaker
    // probe says "ready", and an event fired now is still dropped on the floor.
    expect(drivableGap({ ...BOOTED, windowReady: false })).toContain("handshake");
  });

  it("refuses an app whose React shell has not mounted", () => {
    expect(drivableGap({ ...BOOTED, appShell: false, windowReady: false })).toContain("app shell");
  });

  // Audit finding #3: appShell must SHARPEN the message, never decide it. A CSS
  // class is a proxy — rename `.app-shell` and a gate on it hangs forever
  // against a healthy app, which is the failure this module exists to kill.
  it("accepts a ready window even if the shell selector stops matching", () => {
    expect(drivableGap({ ...BOOTED, appShell: false })).toBeNull();
  });

  it("still names the shell stage when neither has landed", () => {
    expect(drivableGap({ ...BOOTED, appShell: false, windowReady: false }))
      .toContain("app shell");
  });

  it("names the handshake stage once the shell is up", () => {
    expect(drivableGap({ ...BOOTED, appShell: true, windowReady: false }))
      .toContain("handshake");
  });

  it("ACCEPTS a fresh profile showing the welcome screen", () => {
    // No editor, no tabs, and entirely drivable — this is what a CI runner
    // boots into. A predicate that demands an open document hangs here.
    expect(drivableGap({ ...BOOTED })).toBeNull();
  });

  it.each([
    ["tauriInvoke", "invoke"],
    ["tauriEmit", "emit"],
  ])("refuses an app whose __TAURI__.%s is not callable", (field, needle) => {
    expect(drivableGap({ ...BOOTED, [field]: false })).toContain(needle);
  });

  it("reports the EARLIEST missing stage, not the last check", () => {
    // Boot order: Tauri APIs, then the shell, then the handshake. A run stuck
    // before the bridge is live must say so rather than blaming the handshake.
    expect(drivableGap({ tauriEmit: false, tauriInvoke: false, appShell: false, windowReady: false }))
      .toContain("invoke");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 2],
    ["a string", "ready"],
    ["an array", []],
  ])("fails closed on %s rather than treating it as ready", (_label, value) => {
    // `execute_js` resolves with `undefined` when the evaluated expression
    // threw inside the webview. Reading that as ready is how the gate goes
    // quiet — the exact failure mode this module replaced.
    expect(drivableGap(value)).not.toBeNull();
  });

  it("refuses truthy-but-wrong field values rather than coercing them", () => {
    // A future probe edit that returns strings must fail loudly here, not pass
    // because "false" is truthy.
    expect(
      drivableGap({ tauriEmit: "yes", tauriInvoke: "yes", appShell: "yes", windowReady: "true" }),
    ).not.toBeNull();
  });
});

describe("DRIVABLE_SNIPPET", () => {
  it("is a self-contained expression that evaluates to a snapshot", () => {
    const snapshot = evaluateSnippet({
      document: {
        querySelector: () => null,
        documentElement: { getAttribute: () => null },
      },
      window: {},
    });
    expect(snapshot).toEqual({
      tauriEmit: false,
      tauriInvoke: false,
      appShell: false,
      windowReady: false,
    });
    expect(drivableGap(snapshot)).not.toBeNull();
  });

  it("reports a ready window as drivable end to end", () => {
    const snapshot = evaluateSnippet({
      document: {
        querySelector: (s) => (s === ".app-shell" ? {} : null),
        documentElement: { getAttribute: () => "true" },
      },
      window: { __TAURI__: { event: { emit: () => {} }, core: { invoke: () => {} } } },
    });
    expect(drivableGap(snapshot)).toBeNull();
  });

  it("treats a missing attribute as NOT ready rather than throwing", () => {
    // `getAttribute` returns null for an absent attribute; a probe that threw
    // here would surface as an opaque `execute_js` failure instead of "not
    // ready yet", and the two need different responses from an operator.
    const snapshot = evaluateSnippet({
      document: {
        querySelector: () => ({}),
        documentElement: { getAttribute: () => null },
      },
      window: { __TAURI__: { event: { emit: () => {} }, core: { invoke: () => {} } } },
    });
    expect(snapshot.windowReady).toBe(false);
    expect(drivableGap(snapshot)).toContain("handshake");
  });

  it("gates on the handshake attribute, not on an open document", () => {
    // Interpolated from the constant, so the attribute has ONE spelling here
    // (audit finding #2) rather than a literal that can drift from it.
    expect(DRIVABLE_SNIPPET).toContain(`getAttribute('${READY_ATTRIBUTE}')`);
    expect(DRIVABLE_SNIPPET).not.toContain("ProseMirror");
    expect(DRIVABLE_SNIPPET).not.toContain("data-tab-id");
  });
});
