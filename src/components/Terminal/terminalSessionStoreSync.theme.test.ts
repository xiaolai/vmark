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
import { useTabStore } from "@/stores/tabStore";
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
// Tab state is global, and the browser-neutral cases below mutate it. Without
// restoring it, a later test mounts with the browser ALREADY active, so its
// "activate the browser tab" step changes nothing and the assertion sees an
// untouched `theme` — a false failure that looks exactly like a real one.
const initialTabs = useTabStore.getState().tabs;
const initialActiveTabId = useTabStore.getState().activeTabId;

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
    useTabStore.setState({ tabs: initialTabs, activeTabId: initialActiveTabId } as never);
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

/**
 * A browser frame has to be a TRUE neutral, so the terminal beside it drops the
 * tinted theme while a browser tab is focused. The shell already does this in
 * CSS; xterm paints a canvas from a JS theme object, so it needs the same rule
 * applied here or the two disagree down the full height of the window.
 */
describe("useUIStoreSync — browser-neutral terminal", () => {
  function setBrowserTabActive(active: boolean): void {
    act(() => {
      useTabStore.setState({
        tabs: {
          main: [
            { id: "d1", kind: "document" },
            { id: "b1", kind: "browser" },
          ],
        },
        activeTabId: { main: active ? "b1" : "d1" },
      } as never);
    });
  }

  it("collapses a tinted LIGHT theme to the white neutral", () => {
    const entry = makeEntry();
    const sessionsRef = { current: new Map([["s1", entry]]) };
    setAppearance({ theme: "paper", followSystemAppearance: false });
    renderHook(() => useUIStoreSync(sessionsRef));

    setBrowserTabActive(true);

    // paper's #eeeded is the warm grey that looked wrong beside a web page.
    expect(entry.instance.term.options.theme).toEqual(buildXtermThemeForId("white"));
  });

  it("collapses a tinted DARK theme to the dark neutral, not to white", () => {
    const entry = makeEntry();
    const sessionsRef = { current: new Map([["s1", entry]]) };
    setAppearance({ theme: "solarized", followSystemAppearance: false });
    renderHook(() => useUIStoreSync(sessionsRef));

    setBrowserTabActive(true);

    // Forcing white here would put solarized's ANSI palette on a white
    // background — unreadable. This is why the rule branches on isDark.
    expect(entry.instance.term.options.theme).toEqual(buildXtermThemeForId("night"));
  });

  it("restores the user's theme when focus leaves the browser tab", () => {
    const entry = makeEntry();
    const sessionsRef = { current: new Map([["s1", entry]]) };
    setAppearance({ theme: "paper", followSystemAppearance: false });
    renderHook(() => useUIStoreSync(sessionsRef));

    setBrowserTabActive(true);
    expect(entry.instance.term.options.theme).toEqual(buildXtermThemeForId("white"));

    setBrowserTabActive(false);
    expect(entry.instance.term.options.theme).toEqual(buildXtermThemeForId("paper"));
  });
});
