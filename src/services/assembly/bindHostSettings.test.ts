/**
 * The app's binding of the plugin host-settings seam.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts
 * @module services/assembly/bindHostSettings.test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { bindPluginHostSettings } from "./bindHostSettings";
import { hostSettings, resetHostSettings } from "@/plugins/shared/hostSettings";
import { hostDocument, resetHostDocument } from "@/plugins/shared/hostDocument";
import { hostPopups } from "@/plugins/shared/hostPopups";
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

describe("HTML rendering and cursor bindings", () => {
  it("maps the user's HTML settings onto the seam", () => {
    useSettingsStore.getState().updateMarkdownSetting("htmlRenderingMode", "hidden");
    bindPluginHostSettings();
    expect(hostSettings.htmlRendering().mode).toBe("hidden");
    useSettingsStore.getState().updateMarkdownSetting("htmlRenderingMode", "sanitized");
  });

  it("falls back to the SAFE values when the settings blob lacks them", () => {
    // A blob written before a field existed must not yield permissive HTML.
    const real = useSettingsStore.getState();
    vi.spyOn(useSettingsStore, "getState").mockReturnValue({
      ...real,
      markdown: { ...real.markdown, htmlRenderingMode: undefined, htmlAllowlistLevel: undefined },
    } as never);
    bindPluginHostSettings();
    const html = hostSettings.htmlRendering();
    expect(html.mode).toBe("sanitized");
    expect(html.allowlistLevel).toBe("strict");
    vi.restoreAllMocks();
  });

  it("routes a cursor report to the active tab, and drops it when there is none", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const { useDocumentStore } = await import("@/stores/documentStore");
    bindPluginHostSettings();

    // No tab for this window — the report is dropped rather than throwing.
    expect(() => hostDocument.reportCursorInfo("nowhere", { sourceLine: 1 })).not.toThrow();

    const tabId = useTabStore.getState().createTab("main", null);
    useDocumentStore.getState().initDocument(tabId, "body", "/tmp/c.md");
    hostDocument.reportCursorInfo("main", { sourceLine: 7 });
    expect(useDocumentStore.getState().getDocument(tabId)?.cursorInfo).toMatchObject({
      sourceLine: 7,
    });
  });
});

describe("the link-surface bindings map requests onto the real stores", () => {
  const rect = { top: 1, left: 2, bottom: 3, right: 4 };

  beforeEach(() => {
    bindPluginHostSettings();
  });

  it("reports nothing open before anything opens", async () => {
    const { usePopupStore } = await import("@/stores/popupStore");
    usePopupStore.setState(usePopupStore.getInitialState());
    expect(hostPopups.anyLinkSurfaceOpen()).toBe(false);
  });

  it("opens the link EDIT popup with the range it was given", async () => {
    const { useLinkPopupStore } = await import("@/stores/linkPopupStore");
    hostPopups.openLinkPopup({ href: "a.md", linkFrom: 3, linkTo: 9, anchorRect: rect });
    const state = useLinkPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.href).toBe("a.md");
    expect(state.linkFrom).toBe(3);
    expect(state.linkTo).toBe(9);
    // Any of the four counts as "a link surface is open" — that is the whole
    // point of the query, which guards against stacking a second popup.
    expect(hostPopups.anyLinkSurfaceOpen()).toBe(true);
    state.closePopup();
  });

  it("opens the link CREATE popup with its own range and text-input flag", async () => {
    const { useLinkCreatePopupStore } = await import("@/stores/linkCreatePopupStore");
    hostPopups.openLinkCreatePopup({
      text: "label",
      rangeFrom: 1,
      rangeTo: 6,
      anchorRect: rect,
      showTextInput: true,
    });
    const state = useLinkCreatePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.text).toBe("label");
    expect(state.showTextInput).toBe(true);
    expect(hostPopups.anyLinkSurfaceOpen()).toBe(true);
    state.closePopup();
  });

  it("flattens the wiki-link request into the store's positional call", async () => {
    // The store takes (rect, target, pos); the seam takes one object. This is
    // the shape mismatch the request types exist to absorb.
    const { useWikiLinkPopupStore } = await import("@/stores/wikiLinkPopupStore");
    hostPopups.openWikiLinkPopup({ anchorRect: rect, target: "notes/todo", nodePos: 12 });
    const state = useWikiLinkPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.target).toBe("notes/todo");
    expect(state.nodePos).toBe(12);
    expect(hostPopups.anyLinkSurfaceOpen()).toBe(true);
    state.closePopup();
  });

  it("opens the heading picker and keeps the plugin's callback callable", async () => {
    const { useHeadingPickerStore } = await import("@/stores/headingPickerStore");
    const onSelect = vi.fn();
    const headings = [{ id: "h1", text: "First", level: 1 }];
    hostPopups.openHeadingPicker({ headings, onSelect, anchorRect: rect });
    expect(useHeadingPickerStore.getState().isOpen).toBe(true);
    expect(hostPopups.anyLinkSurfaceOpen()).toBe(true);
    useHeadingPickerStore.getState().selectHeading(headings[0]);
    expect(onSelect).toHaveBeenCalledWith("h1", "First");
  });

  it("closes the universal toolbar only when it is open", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    useUIStore.getState().setUniversalToolbarVisible(false);
    // False means "Escape was NOT consumed", so the caller falls through.
    expect(hostPopups.dismissUniversalToolbar()).toBe(false);

    useUIStore.getState().setUniversalToolbarVisible(true);
    expect(hostPopups.dismissUniversalToolbar()).toBe(true);
    expect(useUIStore.getState().universalToolbarVisible).toBe(false);
  });
});
