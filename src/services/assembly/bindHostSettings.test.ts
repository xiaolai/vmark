/**
 * The app's binding of the plugin host-settings seam.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts
 * @module services/assembly/bindHostSettings.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { bindPluginHostSettings } from "./bindHostSettings";
import { hostSettings, resetHostSettings } from "@/plugins/shared/hostSettings";
import { hostDocument, resetHostDocument } from "@/plugins/shared/hostDocument";
import { useSettingsStore } from "@/stores/settingsStore";

afterEach(() => {
  resetHostSettings();
  resetHostDocument();
});

describe("bindPluginHostSettings", () => {
  it("makes the seam read the user's real tab size", () => {
    useSettingsStore.getState().updateGeneralSetting("tabSize", 8);
    bindPluginHostSettings();
    expect(hostSettings.tabSize()).toBe(8);
    useSettingsStore.getState().updateGeneralSetting("tabSize", 2);
  });

  it("reads LIVE, so changing the setting afterwards is picked up", () => {
    // Bound once at startup; the getter is what re-reads. Capturing the value
    // at bind time would freeze whatever the user had when the app launched.
    bindPluginHostSettings();
    useSettingsStore.getState().updateGeneralSetting("tabSize", 6);
    expect(hostSettings.tabSize()).toBe(6);
    useSettingsStore.getState().updateGeneralSetting("tabSize", 2);
  });
});

describe("the document lookup", () => {
  it("reports the active tab's path for a window", () => {
    bindPluginHostSettings();
    // No tab open in this label — null is the honest answer, and the branch a
    // fresh window actually takes.
    expect(hostDocument.activeFilePath("no-such-window")).toBeNull();
  });

  it("returns null when the tab exists but holds no document", () => {
    bindPluginHostSettings();
    expect(hostDocument.activeFilePath("main")).toBeNull();
  });
});

describe("a real tab resolves to its document path", () => {
  it("reads the path through the tab and document stores", async () => {
    // The other branch of the lookup: a tab that exists AND has a document.
    const { useTabStore } = await import("@/stores/tabStore");
    const { useDocumentStore } = await import("@/stores/documentStore");
    const tabId = useTabStore.getState().createTab("main", null);
    useDocumentStore.getState().initDocument(tabId, "body", "/tmp/doc.md");

    bindPluginHostSettings();
    expect(hostDocument.activeFilePath("main")).toBe("/tmp/doc.md");
  });
});

describe("the table-width setting", () => {
  it("reads the user's choice", () => {
    useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", true);
    bindPluginHostSettings();
    expect(hostSettings.tableFitToWidth()).toBe(true);
    useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", false);
  });

  it("falls back to false when unset", () => {
    bindPluginHostSettings();
    expect(hostSettings.tableFitToWidth()).toBe(false);
  });
});

describe("the bindings tolerate a settings object missing a key", () => {
  it("falls back rather than reporting undefined", async () => {
    // A persisted settings blob written before a field existed has no value
    // for it. The plugin has no store to fall back to, so this mapping is the
    // only place that can answer — and `undefined` would reach the plugin as a
    // truthy-looking absence.
    const { useSettingsStore } = await import("@/stores/settingsStore");
    const real = useSettingsStore.getState();
    vi.spyOn(useSettingsStore, "getState").mockReturnValue({
      ...real,
      general: { ...real.general, tabSize: undefined },
      markdown: { ...real.markdown, tableFitToWidth: undefined },
    } as never);

    bindPluginHostSettings();
    expect(hostSettings.tableFitToWidth()).toBe(false);
    expect(hostSettings.tabSize()).toBeUndefined();

    vi.restoreAllMocks();
  });
});
