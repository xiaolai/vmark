/**
 * AnchorAction — narrow an edge to one section of its upstream.
 *
 * An unanchored edge asks "did the file change?". An anchored one asks "did the
 * part I depend on change?" — the single biggest lever on M2, since whole-file
 * dependencies are why an edit to an unrelated section raises a flag. The
 * dogfood run judged 5 of 5 flags as noise, and this is the mechanism aimed at
 * that.
 *
 * The section list comes from `fetchEdgeHeadings`, which reads the SAME upstream
 * text `set_anchor` validates against and drops ambiguous or over-deep paths, so
 * the picker never offers a path the setter would refuse — and it sends back
 * exactly the path it displayed rather than reconstructing one.
 *
 * Fetch state is delegated to `useLazyResource` (keyed by workspace + edge, so
 * switching either never shows the other's headings, and each open reloads
 * against the upstream's current text). The set/clear mutation goes through
 * `useInFlightAction`, whose synchronous guard stops a double-click appending
 * two `edge-anchor` entries.
 *
 * @module components/BreakdownPanel/AnchorAction
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { EdgeRow } from "@/stores/breakdownStore";
import { fetchEdgeHeadings, setEdgeAnchor } from "@/services/breakdown/breakdownService";
import { useLazyResource } from "./useLazyResource";
import { useInFlightAction } from "./useInFlightAction";

interface AnchorActionProps {
  row: EdgeRow;
  workspaceRoot: string | null;
}

export function AnchorAction({ row, workspaceRoot }: AnchorActionProps) {
  const { t } = useTranslation("breakdown");
  const anchored = row.anchor_status !== undefined;

  // Key on workspace + edge so switching either resets the picker rather than
  // showing the other's headings. `txf` is a UUID and `input` a number, so the
  // "::" delimiters are unambiguous whatever the workspace path contains.
  const key = workspaceRoot ? `${workspaceRoot}::${row.txf}::${row.input}` : null;
  const fetcher = useCallback(
    () => fetchEdgeHeadings(workspaceRoot as string, row.txf, row.input),
    [workspaceRoot, row.txf, row.input],
  );
  const { open, toggle, data: paths, loading } = useLazyResource<string[][]>(key, fetcher);
  const [run, busy] = useInFlightAction();

  const apply = (path: string[]) => {
    if (!workspaceRoot || busy) return;
    toggle(); // collapse the picker; reopening reloads against current text
    run(() => setEdgeAnchor(workspaceRoot, row.txf, row.input, path));
  };

  if (!open) {
    return (
      <button
        type="button"
        className="breakdown-row__action"
        data-testid="anchor-open"
        disabled={busy || !workspaceRoot}
        onClick={toggle}
        title={t("anchor.hint")}
      >
        {anchored ? t("anchor.change") : t("anchor.set")}
      </button>
    );
  }

  return (
    <span className="breakdown-anchor">
      {loading && <span className="breakdown-anchor__hint">{t("loading")}</span>}

      {/* null (not loading) is an error from the fetch — kept distinct from the
          empty array so a diverged upstream or IO failure does not read as
          "no sections to anchor to". */}
      {!loading && paths === null && (
        <span className="breakdown-anchor__hint" data-testid="anchor-error">
          {t("anchor.error")}
        </span>
      )}

      {!loading && paths !== null && paths.length === 0 && (
        <span className="breakdown-anchor__hint" data-testid="anchor-empty">
          {t("anchor.empty")}
        </span>
      )}

      {paths?.map((p, i) => (
        <button
          key={JSON.stringify(p)}
          type="button"
          className="breakdown-row__action"
          data-testid={`anchor-option-${i}`}
          disabled={busy}
          onClick={() => apply(p)}
        >
          {p.join(" › ")}
        </button>
      ))}

      {anchored && (
        <button
          type="button"
          className="breakdown-row__action"
          data-testid="anchor-clear"
          disabled={busy}
          /* The EMPTY array is the documented clear form. Sending nothing would
             leave the previous anchor live and keep suppressing. */
          onClick={() => apply([])}
        >
          {t("anchor.clear")}
        </button>
      )}

      <button
        type="button"
        className="breakdown-row__action"
        data-testid="anchor-dismiss"
        onClick={toggle}
      >
        {t("lifecycle.cancel")}
      </button>
    </span>
  );
}
