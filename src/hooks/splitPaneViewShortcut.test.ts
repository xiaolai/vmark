// WI-2.2 — F6/Shift+F6 view-mode toggles for split-pane / viewer tabs.

import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { registerFormat, __resetRegistry } from "@/lib/formats/registry";
import type { FormatConfig, SplitViewMode } from "@/lib/formats/types";
import {
  toggleSplitViewMode,
  activeSplitPaneTarget,
  applySplitPaneViewShortcut,
} from "./splitPaneViewShortcut";

const adapters: FormatConfig["adapters"] = {
  saveDialogFilters: [{ name: "P", extensions: ["pfmt"] }],
  untitledExtension: "pfmt",
  readOnlyDefault: false,
  closeSavePolicy: "markdown-default",
  menuPolicy: {
    sourceWysiwygToggle: false,
    cjkFormatActions: false,
    insertBlockActions: false,
    paragraphFormatting: false,
  },
};

const Stub = (() => null) as unknown as FormatConfig["genericPreview"];

const previewFmt: FormatConfig = {
  id: "pfmt",
  nameI18nKey: "format.pfmt",
  extensions: ["pfmt"],
  kind: "split-pane",
  genericPreview: Stub,
  adapters,
};
const plainFmt: FormatConfig = {
  id: "plain",
  nameI18nKey: "format.plain",
  extensions: ["plain"],
  kind: "split-pane", // no genericPreview → preview-less
  adapters,
};
// schemaRenderers WITHOUT a detector to select one → can't produce a preview.
const schemaOnlyFmt: FormatConfig = {
  id: "schemaonly",
  nameI18nKey: "format.schemaonly",
  extensions: ["schemaonly"],
  kind: "split-pane",
  schemaRenderers: { foo: Stub as NonNullable<FormatConfig["genericPreview"]> },
  adapters,
};
// detector + renderers → preview-capable even without a generic preview.
const schemaFullFmt: FormatConfig = {
  id: "schemafull",
  nameI18nKey: "format.schemafull",
  extensions: ["schemafull"],
  kind: "split-pane",
  schemaDetector: () => "foo",
  schemaRenderers: { foo: Stub as NonNullable<FormatConfig["genericPreview"]> },
  adapters,
};
// detector present but selects NO renderer for the content, no generic preview
// → not preview-capable (mirrors SplitPaneEditor showing source-only).
const schemaNoMatchFmt: FormatConfig = {
  id: "schemanomatch",
  nameI18nKey: "format.schemanomatch",
  extensions: ["schemanomatch"],
  kind: "split-pane",
  schemaDetector: () => null,
  schemaRenderers: { foo: Stub as NonNullable<FormatConfig["genericPreview"]> },
  adapters,
};

function resetTabStore() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

/** Create a tab in `main`, force its formatId, and make it active. */
function activeTabWithFormat(formatId: string): string {
  const id = useTabStore.getState().createTab("main", `/f-${formatId}-${Math.floor(performance.now())}.x`);
  useTabStore.getState().setTabFormatId(id, formatId);
  useTabStore.getState().setActiveTab("main", id);
  return id;
}

beforeEach(() => {
  resetTabStore();
  __resetRegistry();
  registerFormat(previewFmt);
  registerFormat(plainFmt);
  registerFormat(schemaOnlyFmt);
  registerFormat(schemaFullFmt);
  registerFormat(schemaNoMatchFmt);
  useSettingsStore.setState((s) => ({
    formats: { ...s.formats, defaultViewMode: "split" },
  }));
});

describe("toggleSplitViewMode (pure, toggle-against-split)", () => {
  it.each<[SplitViewMode, "source" | "preview", SplitViewMode]>([
    ["split", "source", "source"],
    ["source", "source", "split"],
    ["preview", "source", "source"],
    ["split", "preview", "preview"],
    ["preview", "preview", "split"],
    ["source", "preview", "preview"],
  ])("from %s toggling %s → %s", (current, against, expected) => {
    expect(toggleSplitViewMode(current, against)).toBe(expected);
  });
});

describe("activeSplitPaneTarget", () => {
  it("returns the focused preview-capable tab and its effective mode", () => {
    const id = activeTabWithFormat("pfmt");
    expect(activeSplitPaneTarget("main")).toEqual({ tabId: id, mode: "split" });
  });

  it("uses the global default when the tab has no per-tab mode", () => {
    useSettingsStore.setState((s) => ({
      formats: { ...s.formats, defaultViewMode: "preview" },
    }));
    activeTabWithFormat("pfmt");
    expect(activeSplitPaneTarget("main")?.mode).toBe("preview");
  });

  it("returns null for a preview-less format", () => {
    activeTabWithFormat("plain");
    expect(activeSplitPaneTarget("main")).toBeNull();
  });

  it("returns null for schemaRenderers with no detector to select one", () => {
    activeTabWithFormat("schemaonly");
    expect(activeSplitPaneTarget("main")).toBeNull();
  });

  it("treats detector + schemaRenderers as preview-capable", () => {
    activeTabWithFormat("schemafull");
    expect(activeSplitPaneTarget("main")?.mode).toBe("split");
  });

  it("returns null when the detector selects no renderer for the content", () => {
    activeTabWithFormat("schemanomatch");
    expect(activeSplitPaneTarget("main")).toBeNull();
  });

  it("returns null when no tab is active", () => {
    expect(activeSplitPaneTarget("main")).toBeNull();
  });
});

describe("applySplitPaneViewShortcut", () => {
  it("F6 (source) toggles Source⇄Split and reports handled", () => {
    const id = activeTabWithFormat("pfmt"); // starts at split
    expect(applySplitPaneViewShortcut("main", "source")).toBe(true);
    expect(useTabStore.getState().findTabById(id)?.viewMode).toBe("source");
    // Again → back to split.
    applySplitPaneViewShortcut("main", "source");
    expect(useTabStore.getState().findTabById(id)?.viewMode).toBe("split");
  });

  it("Shift+F6 (preview) toggles Preview⇄Split", () => {
    const id = activeTabWithFormat("pfmt");
    applySplitPaneViewShortcut("main", "preview");
    expect(useTabStore.getState().findTabById(id)?.viewMode).toBe("preview");
    applySplitPaneViewShortcut("main", "preview");
    expect(useTabStore.getState().findTabById(id)?.viewMode).toBe("split");
  });

  it("returns false (unhandled) for a preview-less tab", () => {
    activeTabWithFormat("plain");
    expect(applySplitPaneViewShortcut("main", "source")).toBe(false);
  });
});
