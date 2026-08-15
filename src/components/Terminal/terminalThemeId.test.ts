// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
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
