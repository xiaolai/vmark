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
import {
  bindHostPopups,
  type MediaPopupRequest,
  type ImageMenuRequest,
  type FootnotePopupRequest,
} from "@/plugins/shared/hostPopups";
import { useSettingsStore, useShortcutsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";

/** Point the plugin seam at the live settings store. */
export function bindPluginHostSettings(): void {
  bindHostSettings({
    tabSize: () => useSettingsStore.getState().general.tabSize,
    tableFitToWidth: () => useSettingsStore.getState().markdown.tableFitToWidth ?? false,
  });

  bindHostDocument({
    activeFilePath: (windowLabel) => {
      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      if (!tabId) return null;
      return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
    },
  });

  // Typed explicitly rather than inferred: this is the boundary where the
  // plugins' request shape meets the app's store, and a silent mismatch here
  // is exactly what the seam exists to prevent.
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
  });
}
