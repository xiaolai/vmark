import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSystemPrefersDark,
  useSystemAppearanceStore,
} from "./systemAppearanceStore";

describe("systemAppearanceStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useSystemAppearanceStore.setState({ prefersDark: false });
  });

  it("defaults prefersDark to false when matchMedia is unavailable (jsdom)", () => {
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(false);
  });

  it("setPrefersDark updates the store", () => {
    useSystemAppearanceStore.getState().setPrefersDark(true);
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(true);
    useSystemAppearanceStore.getState().setPrefersDark(false);
    expect(useSystemAppearanceStore.getState().prefersDark).toBe(false);
  });
});

describe("readSystemPrefersDark", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when matchMedia is missing", () => {
    expect(readSystemPrefersDark()).toBe(false);
  });

  it("returns the media query result when matchMedia exists", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true })
    );
    expect(readSystemPrefersDark()).toBe(true);
  });

  it("queries prefers-color-scheme: dark", () => {
    const mm = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", mm);
    readSystemPrefersDark();
    expect(mm).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  });

  it("returns false when matchMedia throws", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => {
        throw new Error("boom");
      })
    );
    expect(readSystemPrefersDark()).toBe(false);
  });
});
