/**
 * LifecycleAction — mark a downstream document finished, or reopen it.
 *
 * This is the control that was missing: `coherence_set_lifecycle` and
 * `setDocumentLifecycle` both existed, and nothing in the UI could call either,
 * so no document could be frozen except through MCP or a raw invoke — and the
 * suppressed group could never populate from user action.
 *
 * Asymmetric on purpose. Freezing is confirmed; reopening is not.
 * Freezing is a DOCUMENT decision reached from ONE edge's row, and it silences
 * every edge into that document — including edges not currently on screen. A
 * one-click control here would read as "hide this row" and quietly suppress
 * flags the owner never looked at. Reopening only ever ADDS interruptions back,
 * so it carries no such risk and shouldn't cost a second click.
 *
 * @module components/BreakdownPanel/LifecycleAction
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { EdgeRow } from "@/stores/breakdownStore";
import { setDocumentLifecycle } from "@/services/breakdown/breakdownService";

interface LifecycleActionProps {
  row: EdgeRow;
  workspaceRoot: string | null;
}

export function LifecycleAction({ row, workspaceRoot }: LifecycleActionProps) {
  const { t } = useTranslation("breakdown");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const frozen = row.frozen_downstream === true;
  const label = row.downstream_path ?? row.downstream;

  const apply = (lifecycle: "live" | "frozen") => {
    if (!workspaceRoot || busy) return;
    setBusy(true);
    setConfirming(false);
    void setDocumentLifecycle(workspaceRoot, row.downstream, lifecycle, undefined).finally(
      () => setBusy(false),
    );
  };

  if (confirming) {
    return (
      <span className="breakdown-lifecycle">
        <span className="breakdown-lifecycle__warning">
          {t("lifecycle.confirmScope", { document: label })}
        </span>
        <button
          type="button"
          className="breakdown-row__action"
          data-testid="lifecycle-confirm"
          onClick={() => apply("frozen")}
        >
          {t("lifecycle.confirm")}
        </button>
        <button
          type="button"
          className="breakdown-row__action"
          data-testid="lifecycle-cancel"
          onClick={() => setConfirming(false)}
        >
          {t("lifecycle.cancel")}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="breakdown-row__action"
      disabled={busy || !workspaceRoot}
      onClick={() => (frozen ? apply("live") : setConfirming(true))}
      title={frozen ? t("lifecycle.reopenHint") : t("lifecycle.finishHint")}
    >
      {frozen ? t("lifecycle.reopen") : t("lifecycle.finish")}
    </button>
  );
}
