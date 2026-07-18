import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";
import {
  getEffectiveThemeId,
  resolveEffectiveThemeId,
  useEffectiveThemeId,
} from "./useEffectiveTheme";

const initialAppearance = useSettingsStore.getState().appearance;

function setAppearance(patch: Record<string, unknown>): void {
  act(() => {
    useSettingsStore.setState({
      appearance: {
        ...useSettingsStore.getState().appearance,
        ...patch,
      } as never,
    });
  });
}

function setPrefersDark(value: boolean): void {
  act(() => {
    useSystemAppearanceStore.setState({ prefersDark: value });
  });
}

afterEach(() => {
  act(() => {
    useSettingsStore.setState({ appearance: initialAppearance });
    useSystemAppearanceStore.setState({ prefersDark: false });
  });
});

describe("resolveEffectiveThemeId", () => {
  const base = {
    theme: "sepia",
    followSystemAppearance: false,
    systemLightTheme: "paper",
    systemDarkTheme: "night",
  } as const;

  it.each([
    { follow: false, prefersDark: false, expected: "sepia" },
    { follow: false, prefersDark: true, expected: "sepia" },
    { follow: true, prefersDark: false, expected: "paper" },
    { follow: true, prefersDark: true, expected: "night" },
  ])(
    "follow=$follow, prefersDark=$prefersDark → $expected",
    ({ follow, prefersDark, expected }) => {
      expect(
        resolveEffectiveThemeId(
          { ...base, followSystemAppearance: follow },
          prefersDark
        )
      ).toBe(expected);
    }
  );

  it("treats a missing followSystemAppearance flag as manual (old persisted blobs)", () => {
    const legacy = { theme: "mint" } as never;
    expect(resolveEffectiveThemeId(legacy, true)).toBe("mint");
  });

  it("falls back to defaults when system theme ids are missing", () => {
    const legacy = { theme: "mint", followSystemAppearance: true } as never;
    expect(resolveEffectiveThemeId(legacy, false)).toBe("paper");
    expect(resolveEffectiveThemeId(legacy, true)).toBe("night");
  });
});

describe("getEffectiveThemeId", () => {
  it("returns the manual theme when follow-system is off", () => {
    setAppearance({ theme: "mint", followSystemAppearance: false });
    setPrefersDark(true);
    expect(getEffectiveThemeId()).toBe("mint");
  });

  it("returns the paired theme for the current system appearance", () => {
    setAppearance({
      followSystemAppearance: true,
      systemLightTheme: "white",
      systemDarkTheme: "solarized",
    });
    setPrefersDark(false);
    expect(getEffectiveThemeId()).toBe("white");
    setPrefersDark(true);
    expect(getEffectiveThemeId()).toBe("solarized");
  });
});

describe("useEffectiveThemeId", () => {
  it("re-renders when the system appearance flips while following", () => {
    setAppearance({
      followSystemAppearance: true,
      systemLightTheme: "paper",
      systemDarkTheme: "night",
    });
    setPrefersDark(false);
    const { result } = renderHook(() => useEffectiveThemeId());
    expect(result.current).toBe("paper");

    setPrefersDark(true);
    expect(result.current).toBe("night");
  });

  it("ignores system flips when not following", () => {
    setAppearance({ theme: "sepia", followSystemAppearance: false });
    setPrefersDark(false);
    const { result } = renderHook(() => useEffectiveThemeId());
    expect(result.current).toBe("sepia");

    setPrefersDark(true);
    expect(result.current).toBe("sepia");
  });
});
