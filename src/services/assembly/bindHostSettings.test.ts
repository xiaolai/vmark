/**
 * The app's binding of the plugin host-settings seam.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts
 * @module services/assembly/bindHostSettings.test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { bindPluginHostSettings } from "./bindHostSettings";
import { hostSettings, resetHostSettings } from "@/plugins/shared/hostSettings";
import {
  hostDocument,
  resetHostDocument,
  activeFilePathForCurrentWindow,
} from "@/plugins/shared/hostDocument";
import * as windowFocus from "@/services/navigation/windowFocus";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { hostPopups } from "@/plugins/shared/hostPopups";
import { lintDiagnosticsSource } from "./hostAdapters";
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

  it("binds the REAL window label, so the seam default is never what ships", () => {
    // WI-11 case 10 — "default ≡ app default", the `tabSize` 4-vs-2 lesson in
    // its other direction. The seam's default `currentWindowLabel` is null
    // ("no window"), which is right for a lifted-out plugin and WRONG inside
    // VMark: if the composition root forgets to bind it, every one of the
    // eight callers of `activeFilePathForCurrentWindow()` silently resolves
    // relative links against nothing. Asserting the resolved PATH (not the
    // label) is what makes a missing binding fail here.
    const { getWindowLabel } = windowFocus;
    const tabId = useTabStore.getState().createTab(getWindowLabel(), null);
    useDocumentStore.getState().initDocument(tabId, "body", "/tmp/current-window.md");

    bindPluginHostSettings();
    expect(hostDocument.currentWindowLabel()).toBe(getWindowLabel());
    expect(activeFilePathForCurrentWindow()).toBe("/tmp/current-window.md");
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
      markdown: { ...real.markdown, tableFitToWidth: undefined, lintEnabled: undefined },
      image: { ...real.image, copyToAssets: undefined },
    } as never);

    bindPluginHostSettings();
    expect(hostSettings.tableFitToWidth()).toBe(false);
    // Was asserting `undefined` — i.e. the bug. A missing key must fall back
    // to the APP's default (2), not hand the plugin an absence it will read
    // as a number.
    expect(hostSettings.tabSize()).toBe(2);
    expect(hostSettings.lintEnabled()).toBe(true);
    expect(hostSettings.copyImagesToAssets()).toBe(true);

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
    const { useLinkPopupStore } = await import("@/stores/linkPopupStore");
    const { useLinkCreatePopupStore } = await import("@/stores/linkCreatePopupStore");
    const { useWikiLinkPopupStore } = await import("@/stores/wikiLinkPopupStore");
    const { useHeadingPickerStore } = await import("@/stores/headingPickerStore");
    useLinkPopupStore.setState(useLinkPopupStore.getInitialState());
    useLinkCreatePopupStore.setState(useLinkCreatePopupStore.getInitialState());
    useWikiLinkPopupStore.setState(useWikiLinkPopupStore.getInitialState());
    useHeadingPickerStore.setState(useHeadingPickerStore.getInitialState());
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

describe("the checkpoint binding", () => {
  it("drops the request when the window has no active tab", async () => {
    const { useUnifiedHistoryStore } = await import("@/stores/documentStore");
    bindPluginHostSettings();
    const spy = vi.spyOn(useUnifiedHistoryStore.getState(), "createCheckpoint");
    // The branch that used to live in sourcePeekInline: no tab, no checkpoint.
    hostDocument.checkpoint("nowhere", { markdown: "x", mode: "wysiwyg" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("records a checkpoint for the window's active tab", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const { useDocumentStore, useUnifiedHistoryStore } = await import(
      "@/stores/documentStore"
    );
    bindPluginHostSettings();
    const tabId = useTabStore.getState().createTab("main", null);
    useDocumentStore.getState().initDocument(tabId, "body", "/tmp/cp.md");
    const spy = vi.spyOn(useUnifiedHistoryStore.getState(), "createCheckpoint");
    hostDocument.checkpoint("main", { markdown: "body", mode: "wysiwyg" });
    expect(spy).toHaveBeenCalledWith(
      tabId,
      expect.objectContaining({ markdown: "body", mode: "wysiwyg" })
    );
    spy.mockRestore();
  });

  it("reads the active document's content and hard-break style", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const { useDocumentStore } = await import("@/stores/documentStore");
    bindPluginHostSettings();
    expect(hostDocument.activeContent("nowhere")).toBe("");
    // "unknown" is a real answer: a fresh buffer has no evidence either way.
    expect(hostDocument.activeHardBreakStyle("nowhere")).toBe("unknown");

    const tabId = useTabStore.getState().createTab("main", null);
    useDocumentStore.getState().initDocument(tabId, "line one", "/tmp/hb.md");
    expect(hostDocument.activeContent("main")).toBe("line one");
  });
});

describe("the image bindings", () => {
  it("reads the copy-to-assets setting", () => {
    bindPluginHostSettings();
    useSettingsStore.setState((prev) => ({ image: { ...prev.image, copyToAssets: false } }));
    expect(hostSettings.copyImagesToAssets()).toBe(false);
    useSettingsStore.setState((prev) => ({ image: { ...prev.image, copyToAssets: true } }));
    expect(hostSettings.copyImagesToAssets()).toBe(true);
  });

  it("routes a single-image toast to showToast", async () => {
    const { useImagePasteToastStore } = await import("@/stores/imagePasteToastStore");
    bindPluginHostSettings();
    const dom = document.createElement("div");
    hostPopups.showImagePasteToast({
      anchorRect: { top: 1, left: 2, bottom: 3, right: 4 },
      editorDom: dom,
      onConfirm: () => {},
      imagePath: "/a.png",
      imageType: "localPath",
    });
    const state = useImagePasteToastStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.isMultiple).toBe(false);
    expect(state.imagePath).toBe("/a.png");
    state.hideToast();
  });

  it("routes a batch to showMultiToast, dispatching on imageResults", async () => {
    // The one member serves both toasts; `imageResults` is what tells them
    // apart, so this is the branch worth pinning.
    const { useImagePasteToastStore } = await import("@/stores/imagePasteToastStore");
    bindPluginHostSettings();
    hostPopups.showImagePasteToast({
      anchorRect: { top: 1, left: 2, bottom: 3, right: 4 },
      editorDom: document.createElement("div"),
      onConfirm: () => {},
      imageResults: [{ path: "/a.png" }, { path: "/b.png" }],
    });
    const state = useImagePasteToastStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.isMultiple).toBe(true);
    expect(state.imageCount).toBe(2);
    state.hideToast();
  });
});

describe("the view-mode and editor bindings", () => {
  beforeEach(bindPluginHostSettings);

  it("reads the three view toggles from the UI store", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    const { hostViewModes } = await import("@/plugins/shared/hostViewModes");
    useUIStore.setState({
      focusModeEnabled: true,
      typewriterModeEnabled: true,
      diagramPreviewEnabled: true,
    } as never);
    expect(hostViewModes.focusMode()).toBe(true);
    expect(hostViewModes.typewriterMode()).toBe(true);
    expect(hostViewModes.diagramPreview()).toBe(true);

    useUIStore.setState({
      focusModeEnabled: false,
      typewriterModeEnabled: false,
      diagramPreviewEnabled: false,
    } as never);
    expect(hostViewModes.focusMode()).toBe(false);
  });

  it("notifies view-mode subscribers on any UI-store change", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    const { hostViewModes } = await import("@/plugins/shared/hostViewModes");
    const listener = vi.fn();
    const unsubscribe = hostViewModes.onChange(listener);
    useUIStore.setState({ focusModeEnabled: true } as never);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("exposes both editor surfaces and the focused source view", async () => {
    const { useEditorStore } = await import("@/stores/editorStore");
    const { hostEditors } = await import("@/plugins/shared/hostEditors");
    const view = { cm: true };
    useEditorStore.setState((s) => ({ active: { ...s.active, activeSourceView: view } }) as never);
    expect(hostEditors.activeSourceView()).toBe(view);
    expect(hostEditors.source()).toBe(useEditorStore.getState().source);
    expect(hostEditors.wysiwyg()).toBe(useEditorStore.getState().tiptap);
  });

  it("routes a source-context report into the editor store", async () => {
    const { useEditorStore } = await import("@/stores/editorStore");
    const { hostEditors } = await import("@/plugins/shared/hostEditors");
    const spy = vi.spyOn(useEditorStore.getState(), "setSourceContext");
    const view = { cm: true };
    hostEditors.reportSourceContext({ line: 4 }, view);
    expect(spy).toHaveBeenCalledWith({ line: 4 }, view);
    spy.mockRestore();
  });

  it("binds the source-peek and workflow ports to their stores", async () => {
    const { peekStore } = await import("@/plugins/sourcePeekInline/peekStore");
    const { workflowPort } = await import("@/plugins/codemirror/workflowPort");
    const { useSourcePeekStore } = await import("@/stores/sourcePeekStore");
    const { useWorkflowStore } = await import("@/stores/workflowStore");
    expect(peekStore()).toBe(useSourcePeekStore);
    expect(workflowPort()).toBe(useWorkflowStore);
  });

  it("reads the paste and selection settings from the store", async () => {
    const { hostSettings } = await import("@/plugins/shared/hostSettings");
    useSettingsStore.setState((s) => ({
      markdown: { ...s.markdown, copyOnSelect: true, pasteMode: "plain" },
    }));
    expect(hostSettings.copyOnSelect()).toBe(true);
    expect(hostSettings.pasteMode()).toBe("plain");
  });
});

describe("the search and media bindings", () => {
  beforeEach(bindPluginHostSettings);

  it("routes the find-bar members to the UI store", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    const { hostSearch } = await import("@/plugins/shared/hostSearch");
    hostSearch.open();
    expect(hostSearch.current().isOpen).toBe(true);

    hostSearch.reportMatches(3, 1);
    expect(hostSearch.current().matchCount).toBe(3);
    expect(hostSearch.current().currentIndex).toBe(1);

    hostSearch.findNext();
    expect(hostSearch.current().currentIndex).toBe(2);
    hostSearch.findPrevious();
    expect(hostSearch.current().currentIndex).toBe(1);

    const listener = vi.fn();
    const unsubscribe = hostSearch.onChange(listener);
    useUIStore.getState().searchClose();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("opens the media popup and the image context menu", async () => {
    const { useMediaPopupStore } = await import("@/stores/mediaPopupStore");
    const { useImageContextMenuStore } = await import("@/stores/imageContextMenuStore");
    const rect = { top: 1, left: 2, bottom: 3, right: 4 };
    hostPopups.openMediaPopup({
      mediaSrc: "a.png",
      mediaNodePos: 3,
      mediaNodeType: "image",
      anchorRect: rect,
    });
    expect(useMediaPopupStore.getState().isOpen).toBe(true);
    expect(useMediaPopupStore.getState().mediaSrc).toBe("a.png");
    useMediaPopupStore.getState().closePopup();

    hostPopups.openImageMenu({ position: { x: 5, y: 6 }, imageSrc: "b.png", imageNodePos: 7 });
    expect(useImageContextMenuStore.getState().isOpen).toBe(true);
    useImageContextMenuStore.getState().closeMenu();
  });

  it("opens the footnote popup with its label, content and positions", async () => {
    const { useFootnotePopupStore } = await import("@/stores/footnotePopupStore");
    hostPopups.openFootnotePopup({
      label: "1",
      content: "note",
      anchorRect: { top: 1, left: 2, bottom: 3, right: 4 },
      definitionPos: 10,
      referencePos: 2,
    });
    const state = useFootnotePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.label).toBe("1");
    expect(state.content).toBe("note");
    state.closePopup();
  });

  it("reads, clears and reports lint diagnostics per tab", async () => {
    const { useLintStore } = await import("@/stores/documentStore");
    const diag = [{ id: "E01-1-1", ruleId: "E01" }] as never;
    useLintStore.setState({ diagnosticsByTab: {} } as never);
    expect(lintDiagnosticsSource.get("tab-x")).toEqual([]);

    const listener = vi.fn();
    const unsubscribe = lintDiagnosticsSource.subscribe(listener);
    useLintStore.setState({ diagnosticsByTab: { "tab-x": diag } } as never);
    expect(lintDiagnosticsSource.get("tab-x")).toBe(diag);
    // Reports WHICH tab changed, so a plugin can filter on its own id.
    expect(listener).toHaveBeenCalledWith("tab-x", diag);

    lintDiagnosticsSource.clear("tab-x");
    expect(lintDiagnosticsSource.get("tab-x")).toEqual([]);
    unsubscribe();
  });
});
