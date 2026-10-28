/**
 * Review hunk row — one live hunk in the review panel: what it is and its
 * review state, the actions that state allows, and the one thing the person
 * must know about it (it conflicts, its automatic revert is blocked, or it
 * was edited since).
 *
 * Key decisions:
 *   - The actions follow the review transitions: a pending hunk can be kept
 *     or reverted; a kept one un-kept; a reverted one has its revert undone
 *     (a revert of the revert); a conflicted one kept, reverted again, or
 *     marked handled once the person fixed it by hand. Settled-bound states
 *     (`superseded`, `resolvedByHumanEdit`) offer nothing but Clear reviewed.
 *   - A blocked hunk (its provenance broke, so the journal cannot place it)
 *     says why and offers no revert: the journal would refuse it. A hunk
 *     both blocked and conflicted shows both notes, the block first, since
 *     the conflict note alone would not explain the missing Revert.
 *   - `data-state` carries the journal's state, so what the row shows is
 *     what the journal holds.
 *
 * @coordinates-with services/agentJournal/review/reviewTransitions.ts — the states
 * @coordinates-with components/McpHistory/historyLabels.ts — the hunk words
 * @module components/ReviewPanel/ReviewHunkRow
 */

import { Check, CircleCheck, Redo2, Undo2, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_SM } from "@/utils/iconSizes";
import type { BlockedHunk, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import { breakReasonLabel, hunkLabel, originLabel, type Translate } from "@/components/McpHistory/historyLabels";
import type { HunkAction } from "./useReviewActions";

interface Props {
  hunk: LiveHunk;
  blocked: BlockedHunk | null;
  busy: boolean;
  onAction: (action: HunkAction, hunk: LiveHunk) => void;
}

interface ActionSpec {
  action: HunkAction;
  key: string;
  icon: LucideIcon;
}

const KEEP: ActionSpec = { action: "keep", key: "review.keep", icon: Check };
const REVERT: ActionSpec = { action: "revert", key: "review.revert", icon: Undo2 };

const ACTIONS: Record<LiveHunk["state"], ActionSpec[]> = {
  pending: [KEEP, REVERT],
  kept: [{ action: "unkeep", key: "review.unkeep", icon: X }],
  reverted: [{ action: "revert", key: "review.undoRevert", icon: Redo2 }],
  conflicted: [KEEP, REVERT, { action: "markHandled", key: "review.markHandled", icon: CircleCheck }],
  superseded: [],
  resolvedByHumanEdit: [],
  settled: [],
};

interface Note {
  text: string;
  warning: boolean;
}

/** What the person must know: the block (it is what removes Revert), the conflict, or else an edit since. */
function notesOf(hunk: LiveHunk, blocked: BlockedHunk | null, t: Translate): Note[] {
  const notes: Note[] = [];
  if (blocked) notes.push({ text: t("review.hunkBlocked", { reason: breakReasonLabel(blocked.reason, t), origin: originLabel(blocked.origin, t) }), warning: true });
  if (hunk.state === "conflicted") notes.push({ text: t("review.hunkConflicted"), warning: true });
  if (notes.length === 0 && hunk.editedSince) notes.push({ text: t("review.hunkEditedSince"), warning: false });
  return notes;
}

export function ReviewHunkRow({ hunk, blocked, busy, onAction }: Props): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const notes = notesOf(hunk, blocked, t);
  const actions = ACTIONS[hunk.state].filter((a) => !(blocked && a.action === "revert"));
  return (
    <div className="review-hunk" data-hunk-id={hunk.hunkId} data-state={hunk.state} data-blocked={blocked ? "true" : undefined}>
      <div className="review-hunk__main">
        <span className="review-hunk__label">{hunkLabel(hunk, t)}</span>
        <span className="review-hunk__actions">
          {actions.map(({ action, key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className="popup-icon-btn"
              disabled={busy}
              onClick={() => onAction(action, hunk)}
              title={t(key)}
              aria-label={t(key)}
            >
              <Icon size={ICON_SM} />
            </button>
          ))}
        </span>
      </div>
      {notes.map(({ text, warning }) => (
        <span key={text} className={`review-hunk__note${warning ? " review-hunk__note--warning" : ""}`} title={text}>
          {text}
        </span>
      ))}
    </div>
  );
}
