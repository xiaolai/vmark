/**
 * Purpose: bind the app's stores to the plugins' host seams — settings,
 * document identity, and editor chrome.
 *
 * Called once at startup. Plugins depend on `plugins/shared/hostSettings`,
 * which has working defaults and no store import, so they still run when
 * lifted out of this repo — this is the file that makes them read the user's
 * real preferences inside VMark.
 *
 * @coordinates-with plugins/shared/hostSettings.ts — the seam
 * @module services/assembly/bindHostSettings
 */

import { bindHostSettings } from "@/plugins/shared/hostSettings";
import { bindHostDocument } from "@/plugins/shared/hostDocument";
import { bindHostShortcuts } from "@/plugins/shared/hostShortcuts";
import { bindHostSearch, type SearchQuery } from "@/plugins/shared/hostSearch";
import {
  bindHostPopups,
  type MediaPopupRequest,
  type ImageMenuRequest,
  type FootnotePopupRequest,
} from "@/plugins/shared/hostPopups";
import { useSettingsStore, useShortcutsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";
import { usePopupStore } from "@/stores/popupStore";
import { useEditorStore } from "@/stores/editorStore";
import { bindHostEditors } from "@/plugins/shared/hostEditors";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { bindSourcePeekStore } from "@/plugins/sourcePeekInline/peekStore";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import { bindBlockMathEditingStore } from "@/plugins/codePreview/editingRegistry";
import { useDocumentStore, useUnifiedHistoryStore } from "@/stores/documentStore";

/** The document behind `windowLabel`'s active tab, or undefined. */
function activeDoc(windowLabel: string) {
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  return tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
}
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";

/** Point the plugin seam at the live settings store. */
export function bindPluginHostSettings(): void {
  bindHostSettings({
    tabSize: () => useSettingsStore.getState().general.tabSize,
    onChange: (listener) => useSettingsStore.subscribe(listener),
    tableFitToWidth: () => useSettingsStore.getState().markdown.tableFitToWidth ?? false,
    lintEnabled: () => useSettingsStore.getState().markdown.lintEnabled,
    preserveLineBreaks: () => useSettingsStore.getState().markdown.preserveLineBreaks ?? false,
    hardBreakStyleOnSave: () =>
      useSettingsStore.getState().markdown.hardBreakStyleOnSave ?? "preserve",
    copyImagesToAssets: () => useSettingsStore.getState().image.copyToAssets,
    preserveBlankLines: () => useSettingsStore.getState().markdown.preserveBlankLines ?? true,
    cjkFormatting: () => useSettingsStore.getState().cjkFormatting,
    htmlRendering: () => {
      const m = useSettingsStore.getState().markdown;
      return {
        mode: m.htmlRenderingMode ?? "sanitized",
        allowlistLevel: m.htmlAllowlistLevel ?? "strict",
        customTags: m.htmlAllowlistCustomTags ?? "",
      };
    },
  });

  bindHostEditors({
    source: () => useEditorStore.getState().source,
    wysiwyg: () => useEditorStore.getState().tiptap,
  });

  bindSourcePeekStore(useSourcePeekStore as never);
  bindBlockMathEditingStore(useBlockMathEditingStore as never);

  bindHostDocument({
    activeFilePath: (windowLabel) => {
      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      if (!tabId) return null;
      return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
    },
    reportCursorInfo: (windowLabel, info) => {
      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      if (tabId) useDocumentStore.getState().setCursorInfo(tabId, info as never);
    },
    isTabDirty: (tabId) => useDocumentStore.getState().getDocument(tabId)?.isDirty ?? false,
    workspaceRoot: () => useWorkspaceStore.getState().rootPath ?? null,
    activeContent: (windowLabel) => activeDoc(windowLabel)?.content ?? "",
    activeHardBreakStyle: (windowLabel) => activeDoc(windowLabel)?.hardBreakStyle ?? "unknown",
    checkpoint: (windowLabel, snapshot) => {
      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      if (!tabId) return;
      useUnifiedHistoryStore.getState().createCheckpoint(tabId, {
        markdown: snapshot.markdown,
        mode: snapshot.mode as never,
        cursorInfo: null,
      });
    },
    activeFormatId: (windowLabel) => {
      const tabs = useTabStore.getState();
      const tabId = tabs.activeTabId[windowLabel] ?? null;
      const tab = tabId ? tabs.findTabById(tabId) : null;
      return tab && tab.kind === "document" ? tab.formatId : null;
    },
  });

  // Typed explicitly rather than inferred: this is the boundary where the
  // plugins' request shape meets the app's store, and a silent mismatch here
  // is exactly what the seam exists to prevent.
  bindHostSearch({
    // Typed at the boundary rather than inferred: this is where the app's
    // search slice meets the shape the plugins declare.
    current: (): SearchQuery => useUIStore.getState().search,
    reportMatches: (count, index) => useUIStore.getState().searchSetMatches(count, index),
    findNext: () => useUIStore.getState().searchFindNext(),
    onChange: (listener) => useUIStore.subscribe(listener),
  });

  bindHostShortcuts({
    getShortcut: (id) => useShortcutsStore.getState().getShortcut(id),
    onChange: (listener) => useShortcutsStore.subscribe(listener),
  });

  bindHostPopups({
    openMediaPopup: (request: MediaPopupRequest) =>
      useMediaPopupStore.getState().openPopup(request as never),
    openImageMenu: (request: ImageMenuRequest) =>
      useImageContextMenuStore.getState().openMenu(request),
    openFootnotePopup: (r: FootnotePopupRequest) =>
      useFootnotePopupStore
        .getState()
        .openPopup(r.label, r.content, r.anchorRect as never, r.definitionPos, r.referencePos, r.autoFocus),
    openLinkPopup: (r) => useLinkPopupStore.getState().openPopup(r as never),
    openLinkCreatePopup: (r) => useLinkCreatePopupStore.getState().openPopup(r as never),
    openWikiLinkPopup: (r) =>
      useWikiLinkPopupStore.getState().openPopup(r.anchorRect as never, r.target, r.nodePos),
    openHeadingPicker: (r) =>
      useHeadingPickerStore
        .getState()
        .openPicker(r.headings as never, r.onSelect, {
          anchorRect: r.anchorRect as never,
          containerBounds: r.containerBounds as never,
        }),
    anyLinkSurfaceOpen: () =>
      useLinkPopupStore.getState().isOpen ||
      useLinkCreatePopupStore.getState().isOpen ||
      useWikiLinkPopupStore.getState().isOpen ||
      useHeadingPickerStore.getState().isOpen,
    showImagePasteToast: (r) => {
      const toast = useImagePasteToastStore.getState();
      if (r.imageResults) toast.showMultiToast(r as never);
      else toast.showToast(r as never);
    },
    openEditorContextMenu: (r) =>
      usePopupStore.getState().editorContextOpenMenu(r as never),
    dismissUniversalToolbar: () => {
      const ui = useUIStore.getState();
      if (!ui.universalToolbarVisible) return false;
      ui.setUniversalToolbarVisible(false);
      return true;
    },
  });
}
