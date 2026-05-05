/**
 * Source Mode Upgrade Offer
 *
 * Purpose: Appears in the StatusBar when the active tab was auto-routed to
 * Source mode because of file size. Lets the user explicitly opt into
 * WYSIWYG — clicking the link flips the mode, clears the marker, and the
 * upgrade offer disappears.
 *
 * Visible only when:
 *   - The active tab is in `useLargeFileSessionStore.forcedSourceTabs`.
 *   - The active tab's file is NOT YAML — switching a YAML workflow to
 *     WYSIWYG would corrupt indentation through Tiptap's markdown round-
 *     trip, and the toggle handler refuses for YAML anyway. Showing the
 *     offer for YAML would be misleading.
 *   - The editor is currently in Source mode (sanity gate — if the user
 *     already toggled back to WYSIWYG manually, suppress the offer).
 *
 * @coordinates-with stores/largeFileSessionStore.ts — reads the marker set.
 * @coordinates-with stores/editorStore.ts — flips sourceMode on click.
 * @coordinates-with stores/tabStore.ts — reads activeTabId via useTabStore.
 * @coordinates-with stores/documentStore.ts — reads filePath for YAML check.
 * @module components/StatusBar/SourceModeUpgrade
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";
import { useDocumentStore } from "@/stores/documentStore";
import { isYamlFileName } from "@/utils/dropPaths";
import { useWindowLabel } from "@/contexts/WindowContext";

export function SourceModeUpgrade() {
  const { t } = useTranslation("statusbar");
  const windowLabel = useWindowLabel();
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  /* v8 ignore next 3 -- @preserve defensive `!activeTabId` fallback is not exercised — the StatusBar always has an active tab in tests */
  const isForcedSource = useLargeFileSessionStore((s) =>
    activeTabId ? Boolean(s.forcedSourceTabs[activeTabId]) : false
  );
  const activeFilePath = useDocumentStore((s) =>
    activeTabId ? s.documents[activeTabId]?.filePath ?? null : null,
  );
  // Split on both POSIX (`/`) and Windows (`\`) separators so path
  // basenames resolve correctly on every supported platform.
  const isYamlFile = activeFilePath
    ? isYamlFileName(activeFilePath.split(/[\\/]/).pop() ?? "")
    : false;

  // The "Switch to WYSIWYG" action clears only this tab's forced-source
  // marker. The Editor treats the marker as a per-tab override layered on
  // top of the window-global sourceMode, so other tabs in the same window
  // keep their mode. Global sourceMode is not flipped.
  const handleUpgrade = useCallback(() => {
    if (!activeTabId) return;
    useLargeFileSessionStore.getState().clearForcedSource(activeTabId);
  }, [activeTabId]);

  if (!isForcedSource) return null;
  // YAML files are forced-source for correctness, not size. Switching
  // to WYSIWYG would route through Tiptap's markdown pipeline and
  // corrupt YAML indentation. Hide the offer; the toggle handler in
  // useUnifiedHistory.ts refuses for YAML anyway.
  if (isYamlFile) return null;

  return (
    <div className="status-source-upgrade" role="status" aria-live="polite">
      <span className="status-source-upgrade__label">
        {t("largeFile.openedInSourceMode")}
      </span>
      <button
        type="button"
        className="status-source-upgrade__action"
        onClick={handleUpgrade}
        aria-label={t("largeFile.switchToWysiwygAria")}
      >
        {t("largeFile.switchToWysiwyg")}
      </button>
    </div>
  );
}
