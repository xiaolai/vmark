// @vitest-environment node
// Browser commands — the gated "New Browser Tab" entry point (WI-1.10).
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-1.10
import { beforeEach, describe, expect, it } from "vitest";
import { _resetCommandBus, getCommand, searchCommands } from "./CommandBus";
import { registerBrowserCommands, NEW_BROWSER_TAB_URL } from "./browserCommands";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";

beforeEach(() => {
  _resetCommandBus();
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useSettingsStore.getState().updateBrowserSetting("enabled", false);
  registerBrowserCommands();
});

describe("browser commands", () => {
  it("registers browser.newTab", () => {
    expect(getCommand("browser.newTab")).toBeDefined();
  });

  it("hides browser.newTab from search when the feature is disabled", () => {
    // browser.enabled is false → the command's `when` predicate filters it out.
    const results = searchCommands("browser");
    expect(results.find((r) => r.command.id === "browser.newTab")).toBeUndefined();
  });

  it("surfaces browser.newTab when the feature is enabled", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    const results = searchCommands("browser");
    expect(results.find((r) => r.command.id === "browser.newTab")).toBeDefined();
  });

  it("creates an active browser tab when run", () => {
    getCommand("browser.newTab")!.run({}, { windowLabel: "main" });
    const tabs = useTabStore.getState().tabs.main ?? [];
    const browserTab = tabs.find(isBrowserTab);
    expect(browserTab).toBeDefined();
    expect(useTabStore.getState().activeTabId.main).toBe(browserTab?.id);
  });

  it("opens the default start page", () => {
    getCommand("browser.newTab")!.run({}, { windowLabel: "main" });
    const tab = (useTabStore.getState().tabs.main ?? []).find(isBrowserTab);
    // createBrowserTab canonicalizes the URL (adds a trailing slash).
    expect(tab?.url).toContain(NEW_BROWSER_TAB_URL);
  });

  it("is idempotent to register twice (HMR-safe)", () => {
    registerBrowserCommands();
    expect(getCommand("browser.newTab")).toBeDefined();
  });
});

// Audit 2026-09-03 X-04 — the command is offered only where the surface exists.
describe("browser.newTab platform gate", () => {
  it("is available on macOS with the browser on, and not on other platforms", async () => {
    const { browserAvailableHere } = await import("./browserCommands");
    const { useSettingsStore } = await import("@/stores/settingsStore");
    const original = navigator.platform;
    try {
      useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: true } }));
      Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
      expect(browserAvailableHere()).toBe(true);
      Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
      expect(browserAvailableHere()).toBe(false);
      Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true });
      expect(browserAvailableHere()).toBe(false);
      Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
      useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: false } }));
      expect(browserAvailableHere()).toBe(false);
    } finally {
      Object.defineProperty(navigator, "platform", { value: original, configurable: true });
    }
  });
});
