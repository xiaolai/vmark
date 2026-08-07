// @vitest-environment node
/**
 * The host-view-modes seam.
 *
 * @coordinates-with plugins/shared/hostViewModes.ts
 * @module plugins/shared/hostViewModes.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { hostViewModes, bindHostViewModes, resetHostViewModes } from "./hostViewModes";

afterEach(resetHostViewModes);

describe("the unbound defaults are all OFF", () => {
  it("decorates nothing extra, matching a user who never toggled them", () => {
    expect(hostViewModes.focusMode()).toBe(false);
    expect(hostViewModes.typewriterMode()).toBe(false);
    expect(hostViewModes.diagramPreview()).toBe(false);
  });

  it("returns a working unsubscribe from the no-op onChange", () => {
    const unsubscribe = hostViewModes.onChange(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("binding", () => {
  it("routes each toggle, read FRESH so a flip is not captured stale", () => {
    let focus = false;
    bindHostViewModes({ focusMode: () => focus });
    expect(hostViewModes.focusMode()).toBe(false);
    focus = true;
    expect(hostViewModes.focusMode()).toBe(true);
  });

  it("fans one subscription out to every consumer", () => {
    // Deliberately not per-toggle: each consumer rebuilds wholesale, and
    // three subscriptions would be three chances to leak one.
    const listeners: Array<() => void> = [];
    bindHostViewModes({
      onChange: (l) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
    });
    const a = vi.fn();
    const b = vi.fn();
    const stopA = hostViewModes.onChange(a);
    hostViewModes.onChange(b);
    listeners.forEach((l) => l());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    stopA();
    listeners.forEach((l) => l());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("rebinding replaces rather than merges", () => {
    bindHostViewModes({ typewriterMode: () => true });
    expect(hostViewModes.typewriterMode()).toBe(true);
    bindHostViewModes({});
    expect(hostViewModes.typewriterMode()).toBe(false);
  });
});
