import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// The platform decides whether the resolved theme is narrowed to the
// light/dark pair Windows and Linux can actually draw chrome for
// (theme/themeAvailability.ts). Pinned explicitly rather than inherited from
// jsdom, so these cases state which platform they describe.
const platform = vi.hoisted(() => ({ isMac: true }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  isMacPlatform: () => platform.isMac,
}));
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

beforeEach(() => {
  // Default to macOS: the cases below cover resolution, which is where the
  // full catalog is available. Platform narrowing has its own describe.
  platform.isMac = true;
});

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

// Windows and Linux draw their own title bar (and, on Windows, menu bar), and
// the OS only accepts light or dark. A theme outside that pair would always
// render half-themed, so the resolved id is narrowed to one that matches.
describe("platform narrowing (Windows/Linux)", () => {
  beforeEach(() => {
    platform.isMac = false;
  });

  it("narrows an unsupported light theme to white", () => {
    setAppearance({ theme: "sepia", followSystemAppearance: false });
    expect(getEffectiveThemeId()).toBe("white");
  });

  it("narrows an unsupported dark theme to night", () => {
    setAppearance({ theme: "solarized", followSystemAppearance: false });
    expect(getEffectiveThemeId()).toBe("night");
  });

  it("leaves the two supported themes alone", () => {
    setAppearance({ theme: "white", followSystemAppearance: false });
    expect(getEffectiveThemeId()).toBe("white");
    setAppearance({ theme: "night", followSystemAppearance: false });
    expect(getEffectiveThemeId()).toBe("night");
  });

  it("narrows the follow-system pair too", () => {
    setAppearance({
      followSystemAppearance: true,
      systemLightTheme: "paper",
      systemDarkTheme: "solarized",
    });
    setPrefersDark(false);
    expect(getEffectiveThemeId()).toBe("white");
    setPrefersDark(true);
    expect(getEffectiveThemeId()).toBe("night");
  });

  // The stored pick must survive: someone syncing settings back to macOS
  // should get their sepia back, not a permanently rewritten "white".
  it("does not mutate the stored theme", () => {
    setAppearance({ theme: "sepia", followSystemAppearance: false });
    expect(getEffectiveThemeId()).toBe("white");
    expect(useSettingsStore.getState().appearance.theme).toBe("sepia");
  });

  it("reacts to a system flip while following", () => {
    setAppearance({
      followSystemAppearance: true,
      systemLightTheme: "mint",
      systemDarkTheme: "night",
    });
    setPrefersDark(false);
    const { result } = renderHook(() => useEffectiveThemeId());
    expect(result.current).toBe("white");

    setPrefersDark(true);
    expect(result.current).toBe("night");
  });
});
