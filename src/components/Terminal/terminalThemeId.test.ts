// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

// `currentTerminalThemeId` resolves through `getEffectiveThemeId`, which NARROWS
// the theme to the light/dark pair Windows and Linux can draw chrome for
// (theme/themeAvailability.ts). Without pinning the platform this suite asserted
// a macOS-only outcome: on the Linux CI runner `paper` coerces to `white` and
// "returns the user's theme" failed with expected 'white' to be 'paper'. These
// cases are about the BROWSER-NEUTRAL rule, not platform narrowing, so they pin
// the full catalog — the same reason and the same mock as
// terminalSessionStoreSync.theme.test.ts.
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  isMacPlatform: () => true,
}));

import { currentTerminalThemeId } from "./terminalThemeId";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

const initialAppearance = useSettingsStore.getState().appearance;
const initialTabs = useTabStore.getState().tabs;
const initialActiveTabId = useTabStore.getState().activeTabId;

function setTheme(theme: string): void {
  useSettingsStore.setState({
    appearance: { ...useSettingsStore.getState().appearance, theme, followSystemAppearance: false },
  } as never);
}

function setBrowserActive(active: boolean): void {
  useTabStore.setState({
    tabs: { main: [{ id: "d1", kind: "document" }, { id: "b1", kind: "browser" }] },
    activeTabId: { main: active ? "b1" : "d1" },
  } as never);
}

afterEach(() => {
  useSettingsStore.setState({ appearance: initialAppearance } as never);
  useTabStore.setState({ tabs: initialTabs, activeTabId: initialActiveTabId } as never);
});

describe("currentTerminalThemeId", () => {
  it("is the user's theme when no browser tab is focused", () => {
    setTheme("paper");
    setBrowserActive(false);
    expect(currentTerminalThemeId()).toBe("paper");
  });

  it("collapses to the light neutral under a browser tab", () => {
    setTheme("paper");
    setBrowserActive(true);
    expect(currentTerminalThemeId()).toBe("white");
  });

  it("collapses to the dark neutral under a browser tab in a dark theme", () => {
    setTheme("solarized");
    setBrowserActive(true);
    expect(currentTerminalThemeId()).toBe("night");
  });
});
