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
 *   - The editor is currently in Source mode (sanity gate — if the user
 *     already toggled back to WYSIWYG manually, suppress the offer).
 *
 * @coordinates-with stores/largeFileSessionStore.ts — reads the marker set.
 * @coordinates-with stores/editorStore.ts — flips sourceMode on click.
 * @coordinates-with stores/tabStore.ts — reads activeTabId via useTabStore.
 * @module components/StatusBar/SourceModeUpgrade
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";
import { useWindowLabel } from "@/contexts/WindowContext";

export function SourceModeUpgrade() {
  const { t } = useTranslation("statusbar");
  const windowLabel = useWindowLabel();
  const sourceMode = useEditorStore((s) => s.sourceMode);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const isForcedSource = useLargeFileSessionStore((s) =>
    activeTabId ? Boolean(s.forcedSourceTabs[activeTabId]) : false
  );

  const handleUpgrade = useCallback(() => {
    if (!activeTabId) return;
    useEditorStore.getState().setSourceMode(false);
    useLargeFileSessionStore.getState().clearForcedSource(activeTabId);
  }, [activeTabId]);

  if (!isForcedSource || !sourceMode) return null;

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
