import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useIsDarkTheme } from "./useIsDarkTheme";

describe("useIsDarkTheme", () => {
  const initialAppearance = useSettingsStore.getState().appearance;

  afterEach(() => {
    act(() => {
      useSettingsStore.setState({ appearance: initialAppearance });
    });
  });

  function setTheme(theme: string): void {
    act(() => {
      useSettingsStore.setState({
        appearance: {
          ...useSettingsStore.getState().appearance,
          theme: theme as never,
        },
      });
    });
  }

  it("returns false for the default light theme (paper)", () => {
    setTheme("paper");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });

  it("returns true for the dark theme (night)", () => {
    setTheme("night");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(true);
  });

  it("re-renders when the theme switches light → dark", () => {
    setTheme("paper");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);

    setTheme("night");
    expect(result.current).toBe(true);
  });

  it("re-renders when the theme switches dark → light", () => {
    setTheme("night");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(true);

    setTheme("sepia");
    expect(result.current).toBe(false);
  });

  it("falls back to false when the persisted theme key isn't in the registry", () => {
    setTheme("nonexistent-theme");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });
});
