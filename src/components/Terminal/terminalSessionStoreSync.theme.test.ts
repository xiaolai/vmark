/**
 * Theme-sync coverage for useUIStoreSync: live xterm sessions must retheme
 * on manual theme changes AND on system light/dark flips when the
 * follow-system-appearance setting is on (#1125).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ITheme } from "@xterm/xterm";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";
import { buildXtermThemeForId } from "@/theme";
import {
  useUIStoreSync,
  type SyncableSessionEntry,
} from "./terminalSessionStoreSync";

// Terminal retheming resolves through getEffectiveThemeId, which narrows the
// theme to the light/dark pair Windows and Linux can draw chrome for
// (theme/themeAvailability.ts). These cases are about *retheming*, so they pin
// macOS — the full catalog — instead of inheriting jsdom's platform. The
// narrowing itself is covered in useEffectiveTheme.test.ts.
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  isMacPlatform: () => true,
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@/services/workspaces/activeWorkspaceScope", () => ({
  getActiveWorkspaceScope: () => ({ isWorkspaceMode: false, rootPath: null }),
}));

const initialAppearance = useSettingsStore.getState().appearance;

function makeEntry(): SyncableSessionEntry {
  return {
    instance: {
      term: { options: {} as { theme?: ITheme; fontFamily?: string } },
      isShellBusy: () => false,
      getCwd: () => undefined,
      setOnShellIdle: () => {},
    } as never,
    pty: null,
    shellExited: false,
    spawnedCwd: undefined,
  };
}

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

afterEach(() => {
  act(() => {
    useSettingsStore.setState({ appearance: initialAppearance });
    useSystemAppearanceStore.setState({ prefersDark: false });
  });
});

describe("useUIStoreSync — theme sync", () => {
  it("rethemes sessions on a manual theme change", () => {
    const entry = makeEntry();
    const sessionsRef = { current: new Map([["s1", entry]]) };
    renderHook(() => useUIStoreSync(sessionsRef));

    setAppearance({ theme: "night", followSystemAppearance: false });

    expect(entry.instance.term.options.theme).toEqual(
      buildXtermThemeForId("night")
    );
  });

  it("rethemes sessions when the system flips dark while following", () => {
    const entry = makeEntry();
    const sessionsRef = { current: new Map([["s1", entry]]) };

    setAppearance({
      followSystemAppearance: true,
      systemLightTheme: "paper",
      systemDarkTheme: "solarized",
    });
    renderHook(() => useUIStoreSync(sessionsRef));

    act(() => {
      useSystemAppearanceStore.setState({ prefersDark: true });
    });

    expect(entry.instance.term.options.theme).toEqual(
      buildXtermThemeForId("solarized")
    );
  });

  it("does not retheme on a system flip when not following", () => {
    const entry = makeEntry();
    const sessionsRef = { current: new Map([["s1", entry]]) };

    setAppearance({ theme: "paper", followSystemAppearance: false });
    renderHook(() => useUIStoreSync(sessionsRef));

    act(() => {
      useSystemAppearanceStore.setState({ prefersDark: true });
    });

    expect(entry.instance.term.options.theme).toBeUndefined();
  });
});
