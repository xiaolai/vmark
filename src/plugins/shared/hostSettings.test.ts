/**
 * The host-settings seam.
 *
 * The point of this module is that a plugin reading through it still works
 * when nothing binds it — that is what makes the dependency inverted rather
 * than merely moved. These cases pin that, and the live-read behaviour that
 * stops a plugin capturing a stale value at import time.
 *
 * @coordinates-with plugins/shared/hostSettings.ts
 * @module plugins/shared/hostSettings.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { hostSettings, bindHostSettings, resetHostSettings } from "./hostSettings";

afterEach(resetHostSettings);

describe("an unbound host still gets working values", () => {
  it("defaults tabSize to the app's own default, not merely a sane one", () => {
    // A plugin lifted out of this repo has no store, so it needs a default —
    // but the default must MATCH the app, or an unbound path behaves subtly
    // differently from the shipping one. The parity suite caught this when the
    // seam said 4 and VMark's default was 2.
    expect(hostSettings.tabSize()).toBe(2);
  });

  it("defaults tableFitToWidth to off, matching the app", () => {
    expect(hostSettings.tableFitToWidth()).toBe(false);
  });
});

describe("binding replaces the defaults", () => {
  it("uses the host's answer once bound", () => {
    bindHostSettings({ tabSize: () => 2 });
    expect(hostSettings.tabSize()).toBe(2);
  });

  it("reads LIVE, so a captured reference cannot go stale", () => {
    // `hostSettings` is imported at module load, long before the app binds.
    // Capturing the value rather than the accessor would freeze the default
    // for every plugin that imported early.
    const captured = hostSettings;
    let size = 8;
    bindHostSettings({ tabSize: () => size });
    expect(captured.tabSize()).toBe(8);
    size = 3;
    expect(captured.tabSize()).toBe(3);
  });

  it("accepts a PARTIAL binding, leaving the rest at their defaults", () => {
    // So adding an entry to the interface cannot break a host that already
    // binds the others.
    bindHostSettings({});
    expect(hostSettings.tabSize()).toBe(2);
  });

  it("rebinding replaces rather than merges the previous binding", () => {
    bindHostSettings({ tabSize: () => 9 });
    bindHostSettings({});
    expect(hostSettings.tabSize()).toBe(2);
  });
});

describe("the defaults MATCH the app's, so an unbound path is not a fork", () => {
  it("tabSize agrees with settingsStore's default", async () => {
    // Not a style preference — this is the invariant that stops the seam from
    // quietly becoming a second source of truth. If the app's default changes,
    // this fails and the seam has to follow.
    const { initialState } = await import("@/stores/settingsStore/defaults");
    expect(hostSettings.tabSize()).toBe(initialState.general.tabSize);
    expect(hostSettings.tableFitToWidth()).toBe(initialState.markdown.tableFitToWidth);
  });
});

describe("HTML rendering defaults are the SAFE ones", () => {
  it("defaults to sanitized/strict when nothing is bound", () => {
    // Not merely "the app's defaults" — these are the safe ones. A standalone
    // consumer that binds nothing must not get permissive HTML by accident.
    expect(hostSettings.htmlRendering()).toEqual({
      mode: "sanitized",
      allowlistLevel: "strict",
      customTags: "",
    });
  });

  it("matches the app's own defaults", async () => {
    const { initialState } = await import("@/stores/settingsStore/defaults");
    const d = hostSettings.htmlRendering();
    expect(d.mode).toBe(initialState.markdown.htmlRenderingMode);
    expect(d.allowlistLevel).toBe(initialState.markdown.htmlAllowlistLevel);
  });

  it("notifies on change so a node view can re-render", () => {
    const listeners: Array<() => void> = [];
    bindHostSettings({ onChange: (fn) => (listeners.push(fn), () => {}) });
    let fired = 0;
    hostSettings.onChange(() => (fired += 1));
    listeners.forEach((fn) => fn());
    expect(fired).toBe(1);
  });

  it("defaults onChange to a no-op that still unsubscribes cleanly", () => {
    expect(() => hostSettings.onChange(() => {})()).not.toThrow();
  });
});
