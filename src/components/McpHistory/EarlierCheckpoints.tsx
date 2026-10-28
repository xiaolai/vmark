/**
 * Earlier checkpoints — one global list of the checkpoints kept from before
 * the edit history (ADR-AL14), for every file and window, with a restore per
 * entry, the kept size and a clear-all.
 *
 * Key decisions:
 *   - Global, not per tab: a checkpoint is anchored on a file path or on an
 *     untitled tab that may no longer exist, so each entry names its file or
 *     says it is untitled.
 *   - Restore goes through `restoreEarlierCheckpoint`: an untitled entry, or
 *     a file that cannot be opened, restores into a new document, and the
 *     latter says so.
 *   - The list follows the journal's generation broadcast; a clear here
 *     rewrites the journal, whose broadcast empties the list in every window.
 *     While live updates are not running the panel passes `pollMs`, so a
 *     clear in another window still leaves this list.
 *   - An empty or unreadable list renders nothing, including one that
 *     fails after a good read: a stale entry is never offered for restore.
 *     The panel's other sections are unaffected.
 *   - A failure names the action that failed (restore or clear). A restore
 *     the editor failed after applying warns; one that could not be
 *     confirmed says the document needs recovery.
 *
 * @coordinates-with services/agentJournal/checkpointClient.ts — read and forget
 * @coordinates-with services/agentJournal/earlierCheckpointRestore.ts — restore routing
 * @coordinates-with restoreVerdict.ts — the outcome problems shared with DocumentHistoryList
 * @module components/McpHistory/EarlierCheckpoints
 */

import { useCallback, useRef } from "react";
import { Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_SM } from "@/utils/iconSizes";
import { formatFileSize } from "@/utils/fileSizeThresholds";
import { getFileName } from "@/utils/pathUtils";
import { imeToast as toast } from "@/services/ime/imeToast";
import { forgetJournalCheckpoints, listJournalCheckpoints, type JournalCheckpoint } from "@/services/agentJournal/checkpointClient";
import { restoreEarlierCheckpoint } from "@/services/agentJournal/earlierCheckpointRestore";
import { journalWarn } from "@/utils/debug";
import { historyTime } from "./historyLabels";
import { NOT_DURABLE_KEY, classifyRestore } from "./restoreVerdict";
import { useJournalFeed } from "./useJournalFeed";

const readAll = () => listJournalCheckpoints();
const utf8 = new TextEncoder();

interface Props {
  windowLabel: string;
  /** The panel's poll interval while live updates are not running, or null. */
  pollMs?: number | null;
}

export function EarlierCheckpoints({ windowLabel, pollMs = null }: Props): React.ReactElement | null {
  const { t } = useTranslation("statusbar");
  const { value, failed } = useJournalFeed("all", readAll, () => pollMs);
  const busy = useRef(false);

  const run = useCallback(async (failure: "mcpHistoryRestoreFailed" | "mcpHistoryClearFailed", action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
    } catch (error) {
      journalWarn("earlier checkpoint action failed:", error);
      toast.error(t(failure));
    } finally {
      busy.current = false;
    }
  }, [t]);

  const onRestore = (cp: JournalCheckpoint) =>
    run("mcpHistoryRestoreFailed", async () => {
      const out = await restoreEarlierCheckpoint(cp, windowLabel);
      if (out.status === "cancelled") return;
      const verdict = classifyRestore(out.outcome);
      if (verdict.kind === "problem") toast[verdict.tone](t(verdict.key));
      else if (out.fallback) toast.warning(t("mcpHistoryEarlierFallback", { path: out.fallback.path }));
      else if (!verdict.changed) toast.error(t("mcpHistoryRestoreNoop"));
      else if (!cp.filePath) toast.success(t("mcpHistoryEarlierRestoredNew"));
      else toast.success(t("mcpHistoryRestored", { tool: cp.tool }));
      if (!verdict.durable) toast.warning(t(NOT_DURABLE_KEY));
    });

  if (failed || !value || value.length === 0) return null;
  const entries = [...value].sort((a, b) => b.timestamp - a.timestamp);
  const size = entries.reduce((sum, cp) => sum + utf8.encode(cp.contentBefore).length, 0);

  const onClearAll = () =>
    run("mcpHistoryClearFailed", async () => {
      const report = await forgetJournalCheckpoints(entries.map((cp) => cp.id));
      // @edge-case A failed pack compaction after the clear: the records are gone, their text is not yet.
      if (report.blobError !== null) toast.warning(t("mcpHistoryClearedTextPending"));
      else toast.success(t("mcpHistoryClearedAll"));
    });

  return (
    <section className="mcp-history-section">
      <div className="mcp-history-section__title">{t("mcpHistoryEarlierTitle")}</div>
      <div className="mcp-history-uncommitted__hint">{t("mcpHistoryEarlierHint")}</div>
      <ul className="mcp-history-popover__list" aria-label={t("mcpHistoryEarlierTitle")}>
        {entries.map((cp) => {
          const time = historyTime(cp.timestamp);
          return (
            <li key={cp.id} data-checkpoint={cp.id} className="mcp-history-popover__row">
              <div className="mcp-history-popover__row-meta">
                {time && (
                  <time className="mcp-history-popover__time" dateTime={time.iso}>
                    {time.text}
                  </time>
                )}
                <code className="mcp-history-popover__tool">{cp.tool}</code>
                <span className="mcp-history-popover__file" title={cp.filePath ?? undefined}>
                  {cp.filePath ? getFileName(cp.filePath) : t("mcpHistoryEarlierUntitled")}
                </span>
              </div>
              <div className="mcp-history-popover__description">{cp.description}</div>
              <div className="mcp-history-popover__actions">
                <button
                  type="button"
                  className="popup-icon-btn"
                  onClick={() => void onRestore(cp)}
                  title={t("mcpHistoryEarlierRestore")}
                  aria-label={t("mcpHistoryEarlierRestore")}
                >
                  <Undo2 size={ICON_SM} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <footer className="mcp-history-popover__footer">
        <span className="mcp-history-popover__store">
          {t("mcpHistoryStoreSummary", { count: entries.length, size: formatFileSize(size) })}
        </span>
        <button type="button" className="vm-btn vm-btn--danger vm-btn--compact" onClick={() => void onClearAll()}>
          {t("mcpHistoryClearAll")}
        </button>
      </footer>
    </section>
  );
}
