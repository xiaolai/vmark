/**
 * Tests for the format-settings bridge.
 *
 * Verifies that flipping a `formats.*` toggle:
 *   1. rebuilds the registry to match the new toggle state, and
 *   2. recomputes every open tab's `formatId` (so newly-disabled
 *      formats fall back to txt, newly-enabled formats remount with
 *      the proper adapter via Editor's remount key).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFormatSettingsSubscription } from "./formatSettingsBridge";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { __resetRegistry, getFormatById } from "@/lib/formats/registry";
import { bootstrapFormats, __resetBootstrap } from "@/lib/formats";

let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  __resetRegistry();
  __resetBootstrap();
  // Start from "everything off" so toggle flips have visible effect.
  useSettingsStore.setState({
    formats: {
      dataFormats: false,
      diagrams: false,
      htmlPreview: false,
      codeViewers: false,
      externalEditor: "",
      upgradeNudgeShown: true,
    },
  });
  bootstrapFormats({
    dataFormats: false,
    diagrams: false,
    htmlPreview: false,
    codeViewers: false,
  });
  // Reset tabStore by removing every window's tabs.
  const tabState = useTabStore.getState();
  for (const windowLabel of Object.keys(tabState.tabs)) {
    tabState.removeWindow(windowLabel);
  }
  unsubscribe = installFormatSettingsSubscription();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  __resetRegistry();
  __resetBootstrap();
});

describe("installFormatSettingsSubscription", () => {
  it("registers json/toml when dataFormats flips on", () => {
    expect(getFormatById("json")).toBeUndefined();
    useSettingsStore.getState().updateFormatsSetting("dataFormats", true);
    expect(getFormatById("json")).toBeDefined();
    expect(getFormatById("toml")).toBeDefined();
  });

  it("unregisters html when htmlPreview flips off", () => {
    useSettingsStore.getState().updateFormatsSetting("htmlPreview", true);
    expect(getFormatById("html")).toBeDefined();
    useSettingsStore.getState().updateFormatsSetting("htmlPreview", false);
    expect(getFormatById("html")).toBeUndefined();
  });

  it("recomputes tab formatId when a category turns on", () => {
    // Open a .json tab while dataFormats is off — it should fall back
    // to txt (since json isn't registered yet).
    const tabId = useTabStore.getState().createTab("main", "/x/data.json");
    expect(useTabStore.getState().findTabById(tabId)?.formatId).toBe("txt");

    // Turn on dataFormats — the bridge should rebuild the registry AND
    // recompute every tab's formatId.
    useSettingsStore.getState().updateFormatsSetting("dataFormats", true);
    expect(useTabStore.getState().findTabById(tabId)?.formatId).toBe("json");
  });

  it("recomputes tab formatId when a category turns off", () => {
    useSettingsStore.getState().updateFormatsSetting("codeViewers", true);
    const tabId = useTabStore.getState().createTab("main", "/x/script.ts");
    expect(useTabStore.getState().findTabById(tabId)?.formatId).toBe(
      "code-typescript",
    );

    useSettingsStore.getState().updateFormatsSetting("codeViewers", false);
    expect(useTabStore.getState().findTabById(tabId)?.formatId).toBe("txt");
  });

  it("does not rebuild when an unrelated setting changes", () => {
    useSettingsStore.getState().updateFormatsSetting("dataFormats", true);
    const jsonBefore = getFormatById("json");
    // Flip an unrelated setting (the external-editor field is a
    // member of formats but not a category toggle, so it shouldn't
    // trigger a rebootstrap).
    useSettingsStore
      .getState()
      .updateFormatsSetting("externalEditor", "/Applications/Cursor.app");
    expect(getFormatById("json")).toBe(jsonBefore);
  });
});
