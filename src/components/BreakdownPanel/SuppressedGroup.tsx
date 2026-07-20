/**
 * SuppressedGroup — the edges the layer has decided NOT to ask about, kept
 * visible but out of the way.
 *
 * Why this exists: `frozen_downstream` and `anchor_status` were recorded in the
 * ledger and projected onto every row, but no consumer read them. `status`
 * filtered them out of its badge while the panel rendered them anyway, so the
 * badge said 0 while the list still interrupted — the annotations changed
 * nothing the owner could see.
 *
 * Key decision (design-lifecycle-and-anchors.md): COLLAPSED, not hidden.
 * Hiding would let the layer silently drop a dependency the owner later
 * revives — freezing a document is reversible, and a suppressed edge that
 * cannot be found again is indistinguishable from a lost one.
 *
 * Actionability itself is NOT re-derived here: it arrives as `row.actionable`,
 * computed once in Rust, precisely so the badge and this list cannot diverge
 * the way they already did once.
 *
 * @module components/BreakdownPanel/SuppressedGroup
 */
import { useTranslation } from "react-i18next";
import type { EdgeRow } from "@/stores/breakdownStore";
import { BreakdownRow } from "./BreakdownRow";

interface SuppressedGroupProps {
  rows: EdgeRow[];
  /** Nullable to match `BreakdownRow` and the panel's other sections — the
   *  panel renders before a workspace is necessarily open. */
  workspaceRoot: string | null;
}

export function SuppressedGroup({ rows, workspaceRoot }: SuppressedGroupProps) {
  const { t } = useTranslation("breakdown");

  if (rows.length === 0) return null;

  return (
    <details className="breakdown-suppressed" data-testid="breakdown-suppressed">
      <summary className="breakdown-suppressed__summary">
        {t("suppressed.title", { count: rows.length })}
      </summary>
      <p className="breakdown-suppressed__hint">{t("suppressed.hint")}</p>
      <ul className="breakdown-suppressed__list">
        {rows.map((row) => (
          <li key={`${row.txf}#${row.input}`} className="breakdown-suppressed__item">
            <span className="breakdown-suppressed__reason">
              {row.frozen_downstream
                ? t("suppressed.frozen")
                : t("suppressed.anchorUnchanged")}
            </span>
            <BreakdownRow row={row} workspaceRoot={workspaceRoot} />
          </li>
        ))}
      </ul>
    </details>
  );
}
