/**
 * FlagJudgmentAction — "was surfacing this flag worth it?", the M2 datum.
 *
 * M2 (staleness relevance) is owner-judged and cannot be inferred from
 * behaviour; that was settled during the metrics session and is why
 * `flag-judgment` is its own append-only ledger entry rather than something
 * derived from what the owner clicked. The consequence is that the judgment
 * must be collectable AT the flag — the dogfood run recorded all five through
 * raw invokes because no control existed, which is not a path a real user has.
 *
 * No default answer. A pre-selected option would let an idle click manufacture
 * M2 data, and a metric with fabricated inputs is worse than a missing one.
 * "Unsure" is offered for the same reason: forcing a binary would push genuine
 * uncertainty into relevant/noise and bias the metric silently.
 *
 * @module components/BreakdownPanel/FlagJudgmentAction
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { EdgeRow } from "@/stores/breakdownStore";
import { judgeFlag } from "@/services/breakdown/breakdownService";
import { useInFlightAction } from "./useInFlightAction";

const ANSWERS = ["relevant", "noise", "unsure"] as const;

interface FlagJudgmentActionProps {
  row: EdgeRow;
  workspaceRoot: string | null;
}

export function FlagJudgmentAction({ row, workspaceRoot }: FlagJudgmentActionProps) {
  const { t } = useTranslation("breakdown");
  const [open, setOpen] = useState(false);
  const [run, busy] = useInFlightAction();

  const answer = (judgment: (typeof ANSWERS)[number]) => {
    if (!workspaceRoot || busy) return;
    setOpen(false);
    // Ref-guarded so a double-click cannot append two judgments for one flag.
    run(() => judgeFlag(workspaceRoot, row.txf, row.input, judgment, undefined));
  };

  if (!open) {
    return (
      <button
        type="button"
        className="breakdown-row__action"
        data-testid="judge-open"
        disabled={busy || !workspaceRoot}
        onClick={() => setOpen(true)}
        title={t("judge.hint")}
      >
        {t("judge.open")}
      </button>
    );
  }

  return (
    <span className="breakdown-judge">
      <span className="breakdown-judge__prompt">{t("judge.prompt")}</span>
      {ANSWERS.map((a) => (
        <button
          key={a}
          type="button"
          className="breakdown-row__action"
          data-testid={`judge-${a}`}
          onClick={() => answer(a)}
        >
          {t(`judge.${a}`)}
        </button>
      ))}
      <button
        type="button"
        className="breakdown-row__action"
        data-testid="judge-dismiss"
        onClick={() => setOpen(false)}
      >
        {t("lifecycle.cancel")}
      </button>
    </span>
  );
}
