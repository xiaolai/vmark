/**
 * LogbookSection — the coherence log: every edge's history, the M2 tally, and
 * the churn count behind M4.
 *
 * Loaded lazily through `useLazyResource`. `project_logbook` reads the ENTIRE
 * ledger, so fetching with the panel would tax every open to serve a view most
 * opens don't want. Keying on the workspace also fixes two bugs the earlier
 * hand-rolled cache had: switching workspace kept showing the previous one's
 * log, and the lifetime cache never refreshed after a mutation. Each expand now
 * reloads, so the M2/churn figures reflect the latest ledger.
 *
 * The one thing this view exists to make visible is what a flat entry list
 * hides, both found by dogfooding:
 *
 * - **Churn.** The same edges were ratified 3x each, so M4's burden is
 *   REPETITION, not breadth. `resolutions` is shown per edge and totalled as
 *   `reopenedEdges`.
 * - **Downgraded verdicts.** A tau-downgraded check and a genuine non-answer are
 *   both recorded `unknown`. Only the former shows its preserved verdict, so a
 *   "no signal" row is distinguishable from "the model answered, below tau".
 *
 * @module components/BreakdownPanel/LogbookSection
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { LogbookView } from "@/stores/breakdownStore";
import { fetchLogbook } from "@/services/breakdown/breakdownService";
import { useLazyResource } from "./useLazyResource";

// Backend verdict wire values → i18n keys. Unmapped (future) verdicts fall back
// to the raw value rather than rendering a missing-key placeholder.
const VERDICT_KEY: Record<string, string> = {
  unknown: "unknown",
  "no-contradiction": "noContradiction",
  contradiction: "contradiction",
};

function verdictLabel(t: TFunction, verdict: string): string {
  const key = VERDICT_KEY[verdict];
  return key ? t(`logbook.verdict.${key}`) : verdict;
}

interface LogbookSectionProps {
  workspaceRoot: string | null;
}

export function LogbookSection({ workspaceRoot }: LogbookSectionProps) {
  const { t } = useTranslation("breakdown");
  const fetcher = useCallback(
    () => fetchLogbook(workspaceRoot as string),
    [workspaceRoot],
  );
  const { open, toggle, data: view, loading } = useLazyResource<LogbookView>(
    workspaceRoot,
    fetcher,
  );

  return (
    <section className="breakdown-logbook">
      <button
        type="button"
        className="vm-btn vm-btn--plain"
        data-testid="logbook-toggle"
        onClick={toggle}
        aria-expanded={open}
      >
        {t("logbook.title")}
      </button>

      {open && loading && <p className="breakdown-logbook__hint">{t("loading")}</p>}

      {open && view !== null && (
        <div className="breakdown-logbook__body">
          <p className="breakdown-logbook__m2" data-testid="logbook-m2">
            {t("logbook.m2", {
              relevant: view.m2.relevant,
              noise: view.m2.noise,
              unsure: view.m2.unsure,
              unjudged: view.m2.unjudged,
            })}
          </p>
          <p className="breakdown-logbook__churn" data-testid="logbook-reopened">
            {t("logbook.reopened", { count: view.reopenedEdges })}
          </p>

          <ul className="breakdown-logbook__list">
            {view.rows.map((row, i) => (
              <li key={`${row.txf}#${row.input}`} className="breakdown-logbook__row">
                <span className="breakdown-logbook__edge">
                  {row.txf.slice(0, 8)}#{row.input}
                </span>
                <span
                  className="breakdown-logbook__resolutions"
                  data-testid={`logbook-resolutions-${i}`}
                >
                  {t("logbook.resolutions", { count: row.resolutions })}
                </span>
                {row.judgment && (
                  <span className="breakdown-logbook__judgment">
                    {t(`judge.${row.judgment.judgment}`)}
                  </span>
                )}
                <ul className="breakdown-logbook__checks">
                  {row.checks.map((c, j) => (
                    <li
                      key={`${c.time}-${j}`}
                      className="breakdown-logbook__check"
                      data-testid={`logbook-check-${i}-${j}`}
                    >
                      {verdictLabel(t, c.verdict)}
                      {/* Only a check the model actually answered carries a
                          preserved verdict; a real non-answer must not look
                          like one that was overruled. */}
                      {c.downgradedVerdict
                        ? ` — ${t("logbook.downgraded", {
                            verdict: verdictLabel(t, c.downgradedVerdict),
                            confidence: c.confidence.toFixed(2),
                          })}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
