/**
 * Review panel — the focused document's agent changes still to review: the
 * revisions since the last fully reviewed prefix, grouped by actor and
 * session, each live hunk with keep / revert (and mark handled when it
 * conflicts), the full-backlog banner, and "Clear reviewed".
 *
 * Key decisions:
 *   - It shows the history the history panel already reads (one feed, one
 *     truth): no hunks, no panel.
 *   - The backlog banner appears when the document holds as many
 *     non-settled hunks as the writer allows; agent writes are then refused
 *     `REVIEW_BACKLOG_FULL` until the person reviews and clears. It goes as
 *     soon as a re-read shows fewer.
 *   - Rows are windowed (`ReviewList`), so a document at its limit stays
 *     fast to paint and scroll.
 *   - "Clear reviewed" counts exactly what the journal lets it settle and is
 *     disabled when that is nothing.
 *
 * @coordinates-with components/ReviewPanel/reviewRows.ts — the row model
 * @coordinates-with components/ReviewPanel/useReviewActions.ts — the actions
 * @coordinates-with components/McpHistory/McpHistoryButton.tsx — where it mounts
 * @module components/ReviewPanel/ReviewPanel
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentHistory } from "@/services/agentJournal/docHistoryClient";
import { clearableHunks } from "@/services/agentJournal/reviewClient";
import { ActorLabel } from "@/components/McpHistory/ActorLabel";
import { buildReviewModel, type ReviewRow } from "./reviewRows";
import { ReviewHunkRow } from "./ReviewHunkRow";
import { ReviewList } from "./ReviewList";
import { useReviewActions, type ReviewActions } from "./useReviewActions";
import "./review-panel.css";

interface Props {
  tabId: string;
  docKey: string;
  history: DocumentHistory | null;
  onChanged: () => void;
}

export function ReviewPanel({ history, ...rest }: Props): React.ReactElement | null {
  if (!history || history.hunks.length === 0) return null;
  return <ReviewBody history={history} {...rest} />;
}

function ReviewBody({ tabId, docKey, history, onChanged }: Props & { history: DocumentHistory }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const model = useMemo(() => buildReviewModel(history), [history]);
  const clearable = useMemo(() => clearableHunks(history.hunks).length, [history]);
  const actions = useReviewActions(tabId, docKey, history, onChanged);

  return (
    <section className="mcp-history-section review-panel" aria-label={t("review.title")}>
      <div className="mcp-history-section__title">{t("review.title")}</div>
      {model.backlogFull && (
        <p role="alert" className="review-panel__banner">
          {t("review.backlogFull", { count: history.hunks.length })}
        </p>
      )}
      {model.rows.length === 0 ? (
        <p className="mcp-history-popover__empty">{t("review.allReviewed")}</p>
      ) : (
        <ReviewList rows={model.rows} rowKey={(r) => r.key} renderRow={(r) => <Row row={r} actions={actions} />} label={t("review.listLabel")} />
      )}
      <div className="review-panel__footer">
        <span className="review-panel__counts">
          {model.reviewedPrefix > 0 && <span>{t("review.reviewedPrefix", { count: model.reviewedPrefix })}</span>}
          {model.undecided > 0 && <span>{t("review.undecided", { count: model.undecided })}</span>}
        </span>
        <button type="button" className="vm-btn vm-btn--compact" disabled={clearable === 0 || actions.busy} onClick={actions.onClearReviewed}>
          {t("review.clearReviewed", { count: clearable })}
        </button>
      </div>
    </section>
  );
}

function Row({ row, actions }: { row: ReviewRow; actions: ReviewActions }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  switch (row.type) {
    case "group":
      return (
        <div className="review-panel__group">
          <ActorLabel actor={row.actor} />
          <span className="mcp-history-popover__note">{t("review.groupRevisions", { count: row.revisions })}</span>
        </div>
      );
    case "elsewhere":
      return <div className="review-panel__group">{t("review.elsewhere")}</div>;
    case "hunk":
      return <ReviewHunkRow hunk={row.hunk} blocked={row.blocked} busy={actions.busy} onAction={actions.onHunk} />;
  }
}
