/**
 * Uncommitted entries — the history panel's list of a document's agent
 * writes that were applied but never recorded (the journal refused or lost
 * the commit), each with a restore and a discard action.
 *
 * Key decisions:
 *   - Restore puts back the text the write found, as a controlled restore
 *     that resolves the entry; discard appends `discarded`. Either terminal
 *     record unpins the entry, so the list is re-read (`refresh`, through
 *     the same feed) rather than edited locally: the journal stays the one
 *     source of truth.
 *   - The list is the shared keyed feed (`useJournalFeed`): one document's
 *     entries are never shown, or acted on, under another's key while its
 *     list is read.
 *   - One action at a time: a second click while one is in flight is
 *     ignored, so a double click cannot restore twice.
 *   - A restore the editor failed after applying warns (restored, check the
 *     document); one that could not be confirmed says the document stays
 *     locked for agent edits until VMark restarts. Neither reads as failed.
 *     The restore is classified by the panel's shared `classifyRestore`.
 *   - A restore or discard whose record was not confirmed on disk (queued)
 *     adds the shared not-durable warning beside its own message.
 *   - An unavailable journal, or a document with none, renders nothing
 *     (not the last list read); the panel's other sections are unaffected.
 *   - The list follows the journal's generation broadcast, so an entry
 *     resolved in another window leaves this one's list too; while live
 *     updates are not running the panel passes `pollMs` and the list polls.
 *   - Who made each write is shown in full (`ActorLabel`): an unidentified
 *     client is never shown as a provider.
 *
 * @coordinates-with services/agentJournal/historyClient.ts — list and discard
 * @coordinates-with services/agentJournal/historyRestore.ts — restore
 * @coordinates-with components/McpHistory/restoreVerdict.ts — the outcome's message
 * @coordinates-with components/McpHistory/useJournalFeed.ts — live updates
 * @module components/McpHistory/UncommittedEntries
 */

import { useCallback, useRef } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_SM } from "@/utils/iconSizes";
import { imeToast as toast } from "@/services/ime/imeToast";
import { discardUncommitted, listUncommitted } from "@/services/agentJournal/historyClient";
import { restoreFromHistory } from "@/services/agentJournal/historyRestore";
import { journalWarn } from "@/utils/debug";
import { ActorLabel } from "./ActorLabel";
import { NOT_DURABLE_KEY, classifyRestore } from "./restoreVerdict";
import { useJournalFeed } from "./useJournalFeed";

interface Props {
  tabId: string;
  /** The tab's journal key (`documentIdentity.ts`). */
  docKey: string;
  /** The panel's poll interval while live updates are not running, or null. */
  pollMs?: number | null;
}

export function UncommittedEntries({ tabId, docKey, pollMs = null }: Props): React.ReactElement | null {
  const { t } = useTranslation("statusbar");
  const { value, failed, refresh } = useJournalFeed(docKey, listUncommitted, () => pollMs);
  const busy = useRef(false);

  const act = useCallback(
    async (run: () => Promise<boolean>) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const ok = await run().catch((error: unknown) => {
          journalWarn("uncommitted entry action failed:", error);
          return false;
        });
        if (!ok) toast.error(t("mcpHistoryUncommittedFailed"));
        refresh();
      } finally {
        busy.current = false;
      }
    },
    [refresh, t],
  );

  const onRestore = (txn: string) =>
    act(async () => {
      const out = await restoreFromHistory(tabId, { from: "uncommittedPreimage", txn });
      const verdict = classifyRestore(out);
      // A plain failure is left to the generic failure toast; every other verdict is reported here.
      if (verdict.kind === "problem" && verdict.key === "mcpHistoryRestoreFailed") return false;
      if (verdict.kind === "problem") toast[verdict.tone](t(verdict.key));
      else toast.success(t("mcpHistoryUncommittedRestored"));
      if (!verdict.durable) toast.warning(t(NOT_DURABLE_KEY));
      return true;
    });

  const onDiscard = (txn: string) =>
    act(async () => {
      const { durable } = await discardUncommitted(docKey, txn);
      toast.success(t("mcpHistoryUncommittedDiscarded"));
      if (!durable) toast.warning(t(NOT_DURABLE_KEY));
      return true;
    });

  if (failed || !value || value.length === 0) return null;
  const entries = value;
  return (
    <section className="mcp-history-uncommitted" aria-label={t("mcpHistoryUncommittedTitle", { count: entries.length })}>
      <div className="mcp-history-uncommitted__title">{t("mcpHistoryUncommittedTitle", { count: entries.length })}</div>
      <div className="mcp-history-uncommitted__hint">{t("mcpHistoryUncommittedHint")}</div>
      {entries.map((e) => (
        <article key={e.txn} className="mcp-history-popover__row">
          <div className="mcp-history-popover__row-meta">
            <code className="mcp-history-popover__tool">{e.tool}</code>
            <ActorLabel actor={e.actor} />
          </div>
          <div className="mcp-history-popover__description">
            {e.preview === "" ? t("mcpHistoryUncommittedEmptyText") : e.complete ? e.preview : `${e.preview}…`}
          </div>
          <div className="mcp-history-uncommitted__actions">
            <button
              type="button"
              className="popup-icon-btn"
              onClick={() => void onRestore(e.txn)}
              title={t("mcpHistoryUncommittedRestore")}
              aria-label={t("mcpHistoryUncommittedRestore")}
            >
              <Undo2 size={ICON_SM} />
            </button>
            <button
              type="button"
              className="popup-icon-btn"
              onClick={() => void onDiscard(e.txn)}
              title={t("mcpHistoryUncommittedDiscard")}
              aria-label={t("mcpHistoryUncommittedDiscard")}
            >
              <Trash2 size={ICON_SM} />
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
