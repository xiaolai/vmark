/**
 * Document history list — the focused document's revisions, newest first:
 * who made each one, its kind and tool, the two restore actions, the live
 * hunks each one made, and the changes whose automatic revert is blocked,
 * shown under the revision they were last certified at.
 *
 * Key decisions:
 *   - "Restore this version" restores the row's own revision; "Restore to
 *     before this change" restores its parent. Neither is offered for text
 *     retention collected, and the second not for the first revision (its
 *     parent is the empty document, which the journal does not keep) nor
 *     for a parent the list does not show (truncated: whether its text is
 *     kept is unknown, so the button would be a guess).
 *   - A save recorded with an initiator other than its author (an agent's
 *     `workspace.save` of the user's text) names both: the author, then
 *     "Requested by" the initiator.
 *   - A blocked hunk reads "Blocked: reason (origin)" on its `lastCertified`
 *     row, which is highlighted. With no `lastCertified`, or one older than
 *     the rows shown, the panel says the location is unavailable rather than
 *     guessing one.
 *   - Live hunks are listed one row per persisted hunk under the revision
 *     that made it, in the journal's order, with the journal's kind and
 *     range: touching hunks stay separate rows, nothing is regrouped or
 *     re-diffed. Hunks of a revision the list does not show are listed
 *     apart rather than dropped.
 *   - A concurrent revision (a save that started from another version
 *     than the one before it) says it was edited in two windows; its two
 *     restore actions are the way back to either side. While its text is
 *     kept, "Show both changes" opens both diffs (`ConcurrentPairDiffs`);
 *     a collected one says its text is no longer kept instead.
 *   - A revision whose write said it addressed comments lists them; one the
 *     journal no longer holds reads "deleted comment" (its tombstone keeps
 *     the id, the comment book does not).
 *   - Restores go through `restoreFromHistory`, one at a time; a second
 *     click while one is in flight is ignored. A restore the editor failed
 *     after applying warns (restored, check the document); one that could
 *     not be confirmed says the document stays locked for agent edits until
 *     VMark restarts. Neither is reported as "restore failed".
 *
 * @coordinates-with services/agentJournal/docHistoryClient.ts — the rows
 * @coordinates-with services/agentJournal/historyRestore.ts — the restore
 * @coordinates-with components/McpHistory/historyLabels.ts — the words
 * @coordinates-with components/McpHistory/restoreVerdict.ts — the restore outcome
 * @coordinates-with components/McpHistory/ConcurrentPairDiffs.tsx — both changes of a concurrent row (loaded lazily)
 * @module components/McpHistory/DocumentHistoryList
 */

import { useCallback, useRef } from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_SM } from "@/utils/iconSizes";
import { imeToast as toast } from "@/services/ime/imeToast";
import type { BlockedHunk, DocumentHistory, HistoryRow, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import { restoreFromHistory } from "@/services/agentJournal/historyRestore";
import type { JournalActor } from "@/services/agentJournal/journalActor";
import { journalWarn } from "@/utils/debug";
import { ActorLabel } from "./ActorLabel";
import { LazyConcurrentPairDiffs } from "./lazyHistoryParts";
import { breakReasonLabel, historyTime, hunkLabel, kindLabel, originLabel } from "./historyLabels";
import { NOT_DURABLE_KEY, classifyRestore } from "./restoreVerdict";

interface Props {
  tabId: string;
  /** The journal's key for the document; with none, a concurrent row's two changes cannot be read. */
  docKey: string | null;
  history: DocumentHistory | null;
  failed: boolean;
}

function BlockedLine({ hunk }: { hunk: BlockedHunk }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  return (
    <span className="mcp-history-blocked">
      {t("mcpHistoryBlocked", { reason: breakReasonLabel(hunk.reason, t), origin: originLabel(hunk.origin, t) })}
    </span>
  );
}

/** One row per persisted hunk, exactly as the journal listed them. */
function HunkList({ hunks, label }: { hunks: readonly LiveHunk[]; label: string }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  return (
    <ul className="mcp-history-hunks" aria-label={label}>
      {hunks.map((hunk) => (
        <li key={hunk.hunkId} data-hunk-id={hunk.hunkId} data-state={hunk.state}>
          {hunkLabel(hunk, t)}
        </li>
      ))}
    </ul>
  );
}

/** Live hunks by the revision that made them, keeping the journal's order; those of unshown revisions apart. */
function placeHunks(hunks: readonly LiveHunk[], shown: ReadonlySet<string>): { byTarget: Map<string, LiveHunk[]>; elsewhere: LiveHunk[] } {
  const byTarget = new Map<string, LiveHunk[]>();
  const elsewhere: LiveHunk[] = [];
  for (const hunk of hunks) {
    if (shown.has(hunk.target)) byTarget.set(hunk.target, [...(byTarget.get(hunk.target) ?? []), hunk]);
    else elsewhere.push(hunk);
  }
  return { byTarget, elsewhere };
}

/** Blocked hunks under the shown revision they were last certified at, and those with no shown location. */
function placeBlocked(
  blocked: readonly BlockedHunk[],
  shown: ReadonlySet<string>,
): { anchored: Map<string, BlockedHunk[]>; orphans: BlockedHunk[] } {
  const anchored = new Map<string, BlockedHunk[]>();
  const orphans: BlockedHunk[] = [];
  for (const hunk of blocked) {
    if (hunk.lastCertified !== null && shown.has(hunk.lastCertified)) {
      anchored.set(hunk.lastCertified, [...(anchored.get(hunk.lastCertified) ?? []), hunk]);
    } else orphans.push(hunk);
  }
  return { anchored, orphans };
}

/** Restore one revision of the tab, one restore at a time, reporting the outcome. */
function useHistoryRestore(tabId: string): (revision: string) => Promise<void> {
  const { t } = useTranslation("statusbar");
  const busy = useRef(false);
  return useCallback(
    async (revision: string) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const out = await restoreFromHistory(tabId, { from: "revision", revision }).catch((error: unknown) => {
          journalWarn("history restore failed:", error);
          return null;
        });
        const verdict = classifyRestore(out);
        if (verdict.kind === "problem") toast[verdict.tone](t(verdict.key));
        else if (verdict.changed) toast.success(t("mcpHistoryRestoredVersion"));
        else toast.error(t("mcpHistoryRestoreNoop"));
        if (!verdict.durable) toast.warning(t(NOT_DURABLE_KEY));
      } finally {
        busy.current = false;
      }
    },
    [tabId, t],
  );
}

/** The same recorded actor — an initiator equal to the author adds nothing. */
const sameActor = (a: JournalActor, b: JournalActor): boolean => JSON.stringify(a) === JSON.stringify(b);

interface RowProps {
  row: HistoryRow;
  docKey: string | null;
  /** The parent "Restore to before" puts back, or null when none can be. */
  before: string | null;
  hunks: BlockedHunk[] | undefined;
  live: LiveHunk[] | undefined;
  onRestore: (revision: string) => Promise<void>;
}

function RevisionRow({ row: r, docKey, before, hunks, live, onRestore }: RowProps): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const time = historyTime(r.at);
  return (
    <li
      data-testid={`history-row-${r.revision}`}
      data-blocked={hunks ? "true" : undefined}
      className="mcp-history-popover__row"
    >
      <div className="mcp-history-popover__row-meta">
        {time && (
          <time className="mcp-history-popover__time" dateTime={time.iso}>
            {time.text}
          </time>
        )}
        <span>{kindLabel(r.kind, t)}</span>
        {r.restore && <span className="mcp-history-popover__tag">{t("mcpHistoryRestoreTag")}</span>}
        {r.tool && <code className="mcp-history-popover__tool">{r.tool}</code>}
      </div>
      <ActorLabel actor={r.actor} />
      {r.initiator && !sameActor(r.initiator, r.actor) && (
        <div className="mcp-history-popover__note">
          {t("mcpHistoryRequestedBy")} <ActorLabel actor={r.initiator} />
        </div>
      )}
      {r.kind === "concurrent" && <div className="mcp-history-popover__note">{t("review.editedInTwoWindows")}</div>}
      {r.kind === "concurrent" && !r.collected && docKey !== null && <LazyConcurrentPairDiffs docKey={docKey} revision={r.revision} />}
      {r.addresses.length > 0 && (
        <ul className="mcp-history-hunks" aria-label={t("mcpHistoryAddressed")}>
          {r.addresses.map((a) => (
            <li key={a.comment}>{a.deleted ? t("mcpHistoryAddressedDeleted") : a.comment}</li>
          ))}
        </ul>
      )}
      {live && <HunkList hunks={live} label={t("mcpHistoryHunks")} />}
      {hunks?.map((hunk) => <BlockedLine key={hunk.hunkId} hunk={hunk} />)}
      <div className="mcp-history-popover__actions">
        {r.collected ? (
          <span className="mcp-history-popover__note">{t("mcpHistoryTextCollected")}</span>
        ) : (
          <button
            type="button"
            className="popup-icon-btn"
            onClick={() => void onRestore(r.revision)}
            title={t("mcpHistoryRestoreVersion")}
            aria-label={t("mcpHistoryRestoreVersion")}
          >
            <RotateCcw size={ICON_SM} />
          </button>
        )}
        {before !== null && (
          <button
            type="button"
            className="popup-icon-btn"
            onClick={() => void onRestore(before)}
            title={t("mcpHistoryRestoreBefore")}
            aria-label={t("mcpHistoryRestoreBefore")}
          >
            <Undo2 size={ICON_SM} />
          </button>
        )}
      </div>
    </li>
  );
}

export function DocumentHistoryList({ tabId, docKey, history, failed }: Props): React.ReactElement | null {
  const { t } = useTranslation("statusbar");
  const onRestore = useHistoryRestore(tabId);

  if (history === null) {
    return failed ? <p className="mcp-history-popover__empty">{t("mcpHistoryUnavailable")}</p> : null;
  }

  const byRevision = new Map(history.rows.map((r) => [r.revision, r]));
  const shown = new Set(byRevision.keys());
  const { anchored, orphans } = placeBlocked(history.blocked, shown);
  const { byTarget, elsewhere } = placeHunks(history.hunks, shown);
  /** The parent "Restore to before" puts back, when its row is listed and its text still kept.
   *  @edge-case A parent beyond a truncated list is not offered: whether it was collected is unknown. */
  const restorableParent = (r: HistoryRow): string | null =>
    r.parent !== null && byRevision.get(r.parent)?.collected === false ? r.parent : null;

  return (
    <section className="mcp-history-section" aria-label={t("mcpHistoryRevisionsTitle")}>
      <div className="mcp-history-section__title">{t("mcpHistoryRevisionsTitle")}</div>
      {failed && <p className="mcp-history-popover__empty">{t("mcpHistoryUnavailable")}</p>}
      {orphans.length > 0 && (
        <div className="mcp-history-blocked-group">
          <div className="mcp-history-blocked-group__title">{t("mcpHistoryBlockedNoLocation")}</div>
          <ul aria-label={t("mcpHistoryBlockedNoLocation")}>
            {orphans.map((hunk) => (
              <li key={hunk.hunkId}>
                <BlockedLine hunk={hunk} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {history.rows.length === 0 ? (
        <p className="mcp-history-popover__empty">{t("mcpHistoryNoRevisions")}</p>
      ) : (
        <ol className="mcp-history-popover__list" aria-label={t("mcpHistoryRevisionsTitle")}>
          {history.rows.map((r) => (
            <RevisionRow
              key={r.revision}
              row={r}
              docKey={docKey}
              before={restorableParent(r)}
              hunks={anchored.get(r.revision)}
              live={byTarget.get(r.revision)}
              onRestore={onRestore}
            />
          ))}
        </ol>
      )}
      {elsewhere.length > 0 && (
        <div className="mcp-history-hunks-group">
          <div className="mcp-history-hunks-group__title">{t("mcpHistoryHunksElsewhere")}</div>
          <HunkList hunks={elsewhere} label={t("mcpHistoryHunksElsewhere")} />
        </div>
      )}
      {history.truncated && <p className="mcp-history-popover__note">{t("mcpHistoryTruncated")}</p>}
    </section>
  );
}
