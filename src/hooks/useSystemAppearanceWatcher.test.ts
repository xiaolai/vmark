import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";
import { useSystemAppearanceWatcher } from "./useSystemAppearanceWatcher";

type ChangeListener = (e: { matches: boolean }) => void;

/** Install a controllable matchMedia mock. Modern (addEventListener) shape. */
function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<ChangeListener>();
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_type: string, cb: ChangeListener) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_type: string, cb: ChangeListener) => {
      listeners.delete(cb);
    }),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    mql,
    listeners,
    fire(matches: boolean) {
      mql.matches = matches;
      act(() => {
        for (const cb of [...listeners]) cb({ matches });
      });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    useSystemAppearanceStore.setState({ prefersDark: false });
  });
});

describe("useSystemAppearanceWatcher", () => {
  it("seeds the store from the current media query on mount", () => {
    installMatchMedia(true);
    renderHook(() => useSystemAppearanceWatcher());
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(true);
  });

  it("updates the store when the system appearance changes", () => {
    const mm = installMatchMedia(false);
    renderHook(() => useSystemAppearanceWatcher());
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(false);

    mm.fire(true);
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(true);

    mm.fire(false);
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(false);
  });

  it("removes its listener on unmount", () => {
    const mm = installMatchMedia(false);
    const { unmount } = renderHook(() => useSystemAppearanceWatcher());
    expect(mm.listeners.size).toBe(1);
    unmount();
    expect(mm.listeners.size).toBe(0);
  });

  it("is a no-op when matchMedia is unavailable", () => {
    expect(() => {
      const { unmount } = renderHook(() => useSystemAppearanceWatcher());
      unmount();
    }).not.toThrow();
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(false);
  });

  it("falls back to legacy addListener/removeListener MQLs", () => {
    const listeners = new Set<ChangeListener>();
    const mql = {
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addListener: vi.fn((cb: ChangeListener) => listeners.add(cb)),
      removeListener: vi.fn((cb: ChangeListener) => listeners.delete(cb)),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));

    const { unmount } = renderHook(() => useSystemAppearanceWatcher());
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(true);
    expect(mql.addListener).toHaveBeenCalled();

    act(() => {
      for (const cb of [...listeners]) cb({ matches: false });
    });
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(false);

    unmount();
    expect(listeners.size).toBe(0);
  });
});
