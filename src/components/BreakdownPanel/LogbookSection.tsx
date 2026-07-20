/**
 * LogbookSection — the coherence log: every edge's history, the M2 tally, and
 * the churn count behind M4.
 *
 * Loaded lazily. `project_logbook` reads the ENTIRE ledger, so fetching it with
 * the panel would tax every open to serve a view most opens don't want. The
 * section is therefore collapsed by default and fetches on first expand.
 *
 * The one thing this view exists to make visible is what a flat entry list
 * hides. Two facts, both found by dogfooding:
 *
 * - **Churn.** The same edges were ratified 3x each, so M4's burden is
 *   REPETITION, not breadth. `resolutions` is shown per edge and totalled as
 *   `reopenedEdges`, because "few edges, many times" and "many edges, once"
 *   cost the same in a raw count and mean opposite things.
 * - **Downgraded verdicts.** A tau-downgraded check and a genuine non-answer
 *   are both recorded `unknown`. Conflating them made the dogfood run's "24%
 *   unknown" uninterpretable: a model that answered and was overruled is a
 *   threshold problem, one that had no signal is not.
 *
 * @module components/BreakdownPanel/LogbookSection
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LogbookView } from "@/stores/breakdownStore";
import { fetchLogbook } from "@/services/breakdown/breakdownService";

interface LogbookSectionProps {
  workspaceRoot: string | null;
}

export function LogbookSection({ workspaceRoot }: LogbookSectionProps) {
  const { t } = useTranslation("breakdown");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<LogbookView | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || !workspaceRoot || view !== null || loading) return;
    setLoading(true);
    void fetchLogbook(workspaceRoot)
      .then((v) => setView(v))
      .finally(() => setLoading(false));
  };

  return (
    <section className="breakdown-logbook">
      <button
        type="button"
        className="breakdown-logbook__toggle"
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
                      {c.verdict}
                      {/* Only a check the model actually answered carries a
                          preserved verdict; a real non-answer must not look
                          like one that was overruled. */}
                      {c.downgradedVerdict
                        ? ` — ${t("logbook.downgraded", {
                            verdict: c.downgradedVerdict,
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
