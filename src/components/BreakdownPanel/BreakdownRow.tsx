/**
 * BreakdownRow (WI-1.9b) — one stale/diverged edge: upstream + state badge
 * plus the per-edge actions. Accept-newer and Waive are disabled for
 * `diverged-multi-head` and `unpinnable` (spec §9.2 — no single upstream
 * revision exists to resolve against); Revise stays available because
 * revising is the way out. Waive requires a reason (spec §5.4.3), collected
 * through an inline input whose confirm stays disabled while empty.
 *
 * @module components/BreakdownPanel/BreakdownRow
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { EdgeRow, EdgeStateLabel } from "@/stores/breakdownStore";
import { resolveEdge, reviseEdge } from "@/services/breakdown/breakdownService";

/** States with no single live upstream head — resolution is impossible (spec §9.2). */
const RESOLUTION_LOCKED: ReadonlySet<EdgeStateLabel> = new Set([
  "diverged-multi-head",
  "unpinnable",
]);

/** "diverged-multi-head" → "divergedMultiHead" (i18n keys are camelCase). */
function stateKeyOf(state: EdgeStateLabel): string {
  return state.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

interface BreakdownRowProps {
  row: EdgeRow;
  workspaceRoot: string | null;
}

export function BreakdownRow({ row, workspaceRoot }: BreakdownRowProps) {
  const { t } = useTranslation("breakdown");
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");

  const locked = RESOLUTION_LOCKED.has(row.state);
  const lockedTitle =
    row.state === "diverged-multi-head" ? t("disabledMultiHead") : t("disabledUnpinnable");
  const upstreamLabel = row.upstream_path ?? row.upstream;

  const acceptNewer = () => {
    if (!workspaceRoot) return;
    void resolveEdge(workspaceRoot, {
      action: "accept-newer",
      txf: row.txf,
      input: row.input,
    });
  };

  const revise = () => {
    if (!workspaceRoot || row.downstream_path === null) return;
    void reviseEdge(workspaceRoot, row.downstream_path);
  };

  const confirmWaive = () => {
    const trimmed = reason.trim();
    if (!workspaceRoot || trimmed === "") return;
    setWaiving(false);
    setReason("");
    void resolveEdge(workspaceRoot, {
      action: "waive",
      txf: row.txf,
      input: row.input,
      reason: trimmed,
    });
  };

  return (
    <li className="breakdown-row">
      <div className="breakdown-row__main">
        <span className="breakdown-row__upstream" title={upstreamLabel}>
          {upstreamLabel}
        </span>
        <span className={`breakdown-state-badge breakdown-state-badge--${row.state}`}>
          {t(`states.${stateKeyOf(row.state)}`)}
        </span>
      </div>
      <div className="breakdown-row__actions">
        <button
          type="button"
          className="breakdown-row__action"
          onClick={acceptNewer}
          disabled={locked || !workspaceRoot}
          title={locked ? lockedTitle : t("actions.acceptNewer")}
        >
          {t("actions.acceptNewer")}
        </button>
        <button
          type="button"
          className="breakdown-row__action"
          onClick={revise}
          disabled={!workspaceRoot || row.downstream_path === null}
          title={row.downstream_path === null ? t("reviseUnavailable") : t("actions.revise")}
        >
          {t("actions.revise")}
        </button>
        <button
          type="button"
          className="breakdown-row__action"
          onClick={() => setWaiving((w) => !w)}
          disabled={locked || !workspaceRoot}
          title={locked ? lockedTitle : t("actions.waive")}
          aria-expanded={waiving}
        >
          {t("actions.waive")}
        </button>
      </div>
      {waiving && (
        <div className="breakdown-row__waive">
          <input
            type="text"
            className="breakdown-row__waive-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmWaive();
            }}
            placeholder={t("waiveReasonPlaceholder")}
            aria-label={t("waiveReasonPlaceholder")}
          />
          <button
            type="button"
            className="breakdown-row__action breakdown-row__waive-confirm"
            onClick={confirmWaive}
            disabled={reason.trim() === ""}
          >
            {t("waiveConfirm")}
          </button>
        </div>
      )}
    </li>
  );
}
