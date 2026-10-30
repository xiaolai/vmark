/**
 * Source Mode Upgrade Offer
 *
 * Purpose: Appears in the StatusBar when the active tab was auto-routed to
 * Source mode — because of file size, or because the WYSIWYG parser refused
 * the document (#1407); the label names which. Lets the user explicitly opt
 * into WYSIWYG — clicking the link flips the mode, clears the marker, and the
 * upgrade offer disappears. (A refused document is simply refused again, with
 * a message, until its nesting is reduced.)
 *
 * Visible only when:
 *   - The active tab is in `useLargeFileSessionStore.forcedSourceTabs`.
 *   - The active tab's file is NOT YAML (any `.yml` / `.yaml` name) —
 *     switching YAML to WYSIWYG would corrupt indentation through Tiptap's
 *     markdown round-trip. The toggle handler in
 *     `services/history/unifiedHistory.ts` refuses only for GitHub workflow
 *     paths (`looksLikeWorkflowPath`), so this hide is the guard for every
 *     other YAML file.
 *   - The editor is currently in Source mode (sanity gate — if the user
 *     already toggled back to WYSIWYG manually, suppress the offer).
 *
 * @coordinates-with stores/documentStore/largeFileSession.ts — reads the marker set.
 * @coordinates-with services/history/unifiedHistory.ts — the mode toggle, when the window is in Source mode.
 * @coordinates-with stores/tabStore.ts — reads activeTabId via useTabStore.
 * @coordinates-with stores/documentStore.ts — reads filePath for YAML check.
 * @module components/StatusBar/SourceModeUpgrade
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { toggleSourceModeWithCheckpoint } from "@/services/history/unifiedHistory";
import { isYamlFileName } from "@/utils/dropPaths";
import { useWindowLabel } from "@/contexts/WindowContext";

export function SourceModeUpgrade() {
  const { t } = useTranslation("statusbar");
  const windowLabel = useWindowLabel();
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  /* v8 ignore next 3 -- @preserve defensive `!activeTabId` fallback is not exercised — the StatusBar always has an active tab in tests */
  const forcedReason = useLargeFileSessionStore((s) =>
    activeTabId ? s.forcedSourceTabs[activeTabId] : undefined
  );
  const isForcedSource = forcedReason !== undefined;
  const activeFilePath = useDocumentStore((s) =>
    activeTabId ? s.documents[activeTabId]?.filePath ?? null : null,
  );
  // Split on both POSIX (`/`) and Windows (`\`) separators so path
  // basenames resolve correctly on every supported platform.
  const isYamlFile = activeFilePath
    ? isYamlFileName(activeFilePath.split(/[\\/]/).pop() ?? "")
    : false;

  // The "Switch to WYSIWYG" action clears this tab's forced-source marker —
  // a per-tab override layered on top of the window-global sourceMode. If the
  // window is ALSO in Source mode (turned on from another tab, say), lifting
  // the marker alone switches nothing, so the button did nothing visible
  // (#1407 audit). The ordinary mode toggle then turns the window's Source
  // mode off, with its checkpoint and per-tab mode record; other tabs keep
  // their own mode through that record when they are next shown.
  const handleUpgrade = useCallback(() => {
    if (!activeTabId) return;
    useLargeFileSessionStore.getState().clearForcedSource(activeTabId);
    if (useUIStore.getState().sourceMode) toggleSourceModeWithCheckpoint(windowLabel);
  }, [activeTabId, windowLabel]);

  if (!isForcedSource) return null;
  // YAML files are forced-source for correctness, not size. Switching
  // to WYSIWYG would route through Tiptap's markdown pipeline and
  // corrupt YAML indentation. Hide the offer for every YAML name; the toggle
  // handler in services/history/unifiedHistory.ts refuses only workflow paths.
  if (isYamlFile) return null;

  return (
    <div className="status-source-upgrade" role="status" aria-live="polite">
      <span className="status-source-upgrade__label">
        {forcedReason === "unparseable"
          ? t("unparseable.openedInSourceMode")
          : t("largeFile.openedInSourceMode")}
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
