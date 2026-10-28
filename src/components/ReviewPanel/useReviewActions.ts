/**
 * Review actions — the review panel's keep, un-keep, mark handled, revert
 * and "Clear reviewed", one at a time, each reported to the person and
 * followed by a fresh read of the history.
 *
 * Key decisions:
 *   - A review-only decision (keep, un-keep, mark handled, Clear reviewed)
 *     changes no text, but it is still checked against the editor: when a
 *     history arrives the panel flushes the editors and remembers the
 *     tab's document revision; on the click it flushes again, and if the
 *     revision moved (an edit the panel never saw) the decision is not
 *     sent, the person is told the list was out of date, and it is re-read.
 *     A re-read re-takes the revision only when the list it shows differs
 *     (head, hunk states, blocks) or an action asked for it: the feed also
 *     re-reads on polls and on other documents' journal changes, and those
 *     must not accept an edit made since the list was shown. The revision
 *     is taken in the same commit that shows the list (a layout effect),
 *     so no edit can land between the two.
 *     The check and the send happen in one task, and the journal's own
 *     head and `reviewGen` checks refuse anything that landed in between.
 *   - `JOURNAL_BUSY` (a save of this document is being recorded) is retried
 *     a bounded number of times, re-checking each time; it never waits on
 *     the journal.
 *   - Clear reviewed is irreversible, so it asks first, and checks the
 *     editor only once the person confirmed.
 *   - A revert goes through `revertHunk`, which re-verifies the tab itself;
 *     every outcome, a recorded `conflicted` decision included, has its own
 *     message (`reviewOutcome.ts`).
 *   - After any action, whatever its result, the history is read again, so
 *     the panel never keeps showing a state the journal moved past.
 *
 * @coordinates-with services/agentJournal/reviewClient.ts — the decisions
 * @coordinates-with services/agentJournal/hunkRevert.ts — the revert
 * @coordinates-with components/ReviewPanel/reviewOutcome.ts — the messages
 * @module components/ReviewPanel/useReviewActions
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRevisionStore } from "@/stores/documentStore";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import { imeToast as toast } from "@/services/ime/imeToast";
import { confirmAction } from "@/services/dialogs/confirmAction";
import type { DocumentHistory, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import { revertHunk } from "@/services/agentJournal/hunkRevert";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { clearReviewed, clearableHunks, keepHunk, markHunkHandled, unkeepHunk } from "@/services/agentJournal/reviewClient";
import { journalWarn } from "@/utils/debug";
import { errorNotice, revertNotice, type ReviewNotice } from "./reviewOutcome";

/** Sends of one decision while the journal answers `JOURNAL_BUSY`. */
export const BUSY_ATTEMPTS = 3;
const BUSY_RETRY_MS = 100;

export type HunkAction = "keep" | "unkeep" | "markHandled" | "revert";

const DECIDE = { keep: keepHunk, unkeep: unkeepHunk, markHandled: markHunkHandled } as const;

const isBusy = (e: unknown): boolean => e instanceof JournalRefusal && e.journalCode === "JOURNAL_BUSY";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The editors flushed into the store, then the tab's document revision. */
function flushedRevision(tabId: string): string {
  flushAllWysiwygNow();
  return useRevisionStore.getState().getRevision(tabId);
}

/** What the panel shows of a history: its head and each hunk's review state and block. */
function listSignature(history: DocumentHistory): string {
  const hunks = history.hunks.map((h) => `${h.hunkId}:${h.state}:${h.reviewGen}`);
  const blocked = history.blocked.map((b) => `${b.hunkId}:${b.reason}`);
  return JSON.stringify([history.head, hunks, blocked]);
}

class StaleView extends Error {}

export interface ReviewActions {
  busy: boolean;
  onHunk: (action: HunkAction, hunk: LiveHunk) => void;
  onClearReviewed: () => void;
}

export function useReviewActions(tabId: string, docKey: string, history: DocumentHistory, onChanged: () => void): ReviewActions {
  const { t } = useTranslation("statusbar");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const shown = useRef<string | null>(null);
  const shownList = useRef<string | null>(null);
  const reshow = useRef(false);

  // The revision the list is shown against: taken when the list the person
  // sees changes, or on the re-read an action asked for — never on a re-read
  // that shows the same list, which would accept an edit nobody was shown.
  // Taken in the commit that shows the list: a passive effect runs in a later
  // task, and an edit landing before it would be taken as already shown.
  useLayoutEffect(() => {
    const list = `${tabId}\u0000${listSignature(history)}`;
    if (list === shownList.current && !reshow.current) return;
    shownList.current = list;
    reshow.current = false;
    shown.current = flushedRevision(tabId);
  }, [tabId, history]);

  const tell = useCallback((n: ReviewNotice) => toast[n.tone](n.values ? t(n.key, n.values) : t(n.key)), [t]);

  /** Run `send` after the editor check, retrying a busy journal; StaleView when the editor moved. */
  const checked = useCallback(
    async <T>(send: () => Promise<T>): Promise<T> => {
      for (let attempt = 1; ; attempt++) {
        if (flushedRevision(tabId) !== shown.current) throw new StaleView();
        try {
          return await send();
        } catch (e) {
          if (!isBusy(e) || attempt >= BUSY_ATTEMPTS) throw e;
        }
        await pause(BUSY_RETRY_MS * attempt);
      }
    },
    [tabId],
  );

  const exclusive = useCallback(
    async (work: () => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        await work();
      } catch (e) {
        if (e instanceof StaleView) tell({ tone: "warning", key: "review.refusedStale" });
        else {
          journalWarn("review action failed:", e);
          tell(errorNotice(e));
        }
      } finally {
        running.current = false;
        setBusy(false);
        reshow.current = true;
        onChanged();
      }
    },
    [tell, onChanged],
  );

  const onHunk = useCallback(
    (action: HunkAction, hunk: LiveHunk) =>
      void exclusive(async () => {
        if (action === "revert") {
          tell(revertNotice(await revertHunk(tabId, { hunkId: hunk.hunkId, reviewGen: hunk.reviewGen })));
          return;
        }
        await checked(() => DECIDE[action](docKey, history.head, hunk));
      }),
    [exclusive, checked, tell, tabId, docKey, history.head],
  );

  const onClearReviewed = useCallback(
    () =>
      void exclusive(async () => {
        const count = clearableHunks(history.hunks).length;
        if (count === 0) return;
        const confirmed = await confirmAction({
          title: t("review.clearTitle"),
          message: t("review.clearMessage", { count }),
          actionLabel: t("review.clearAction"),
          kind: "warning",
        });
        if (!confirmed) return;
        const done = await checked(() => clearReviewed(docKey, history));
        if (done) tell({ tone: "success", key: "review.cleared", values: { count: String(count) } });
      }),
    [exclusive, checked, tell, t, docKey, history],
  );

  return { busy, onHunk, onClearReviewed };
}
