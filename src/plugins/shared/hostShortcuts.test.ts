/**
 * The host-shortcuts seam.
 *
 * Both halves matter: a plugin building a keymap needs the current chord AND a
 * signal when it changes, because a rebind must rebuild the keymap of every
 * mounted view — not merely be noticed the next time something happens to run.
 *
 * @coordinates-with plugins/shared/hostShortcuts.ts
 * @module plugins/shared/hostShortcuts.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { hostShortcuts, bindHostShortcuts, resetHostShortcuts } from "./hostShortcuts";

afterEach(resetHostShortcuts);

describe("an unbound host yields no shortcuts, not a crash", () => {
  it("returns an empty chord, which callers already skip", () => {
    expect(hostShortcuts.getShortcut("addCursorAbove")).toBe("");
  });

  it("accepts a subscription and hands back a working unsubscribe", () => {
    const off = hostShortcuts.onChange(() => {});
    expect(() => off()).not.toThrow();
  });
});

describe("binding supplies the real keymap", () => {
  it("passes the id through", () => {
    bindHostShortcuts({ getShortcut: (id) => `chord:${id}` });
    expect(hostShortcuts.getShortcut("skipOccurrence")).toBe("chord:skipOccurrence");
  });

  it("notifies on rebind, so a keymap can be rebuilt", () => {
    const listeners: Array<() => void> = [];
    bindHostShortcuts({ onChange: (fn) => (listeners.push(fn), () => {}) });
    const rebuild = vi.fn();
    hostShortcuts.onChange(rebuild);
    listeners.forEach((fn) => fn());
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("reads LIVE, so a captured reference cannot go stale", () => {
    let chord = "Mod-d";
    bindHostShortcuts({ getShortcut: () => chord });
    const captured = hostShortcuts;
    expect(captured.getShortcut("x")).toBe("Mod-d");
    chord = "Mod-k";
    expect(captured.getShortcut("x")).toBe("Mod-k");
  });

  it("leaves unbound entries at their defaults", () => {
    bindHostShortcuts({ getShortcut: () => "Mod-d" });
    expect(() => hostShortcuts.onChange(() => {})()).not.toThrow();
  });
});
