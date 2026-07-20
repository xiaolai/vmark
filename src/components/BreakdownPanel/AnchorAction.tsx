/**
 * AnchorAction — narrow an edge to one section of its upstream.
 *
 * An unanchored edge asks "did the file change?". An anchored one asks "did the
 * part I depend on change?" — which is the single biggest lever on M2, since
 * whole-file dependencies are precisely why an edit to an unrelated section
 * raises a flag. The dogfood run judged 5 of 5 flags as noise, and this is the
 * mechanism aimed at that.
 *
 * `coherence_set_anchor` and `setEdgeAnchor` both shipped with no caller, so
 * anchoring was unreachable outside MCP.
 *
 * The options come from `fetchEdgeHeadings`, which reads the SAME upstream text
 * `set_anchor` validates against and drops ambiguous or over-deep paths. The
 * picker therefore never shows a path the setter would refuse — and it sends
 * back exactly the path it displayed rather than reconstructing one.
 *
 * @module components/BreakdownPanel/AnchorAction
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { EdgeRow } from "@/stores/breakdownStore";
import { fetchEdgeHeadings, setEdgeAnchor } from "@/services/breakdown/breakdownService";

interface AnchorActionProps {
  row: EdgeRow;
  workspaceRoot: string | null;
}

export function AnchorAction({ row, workspaceRoot }: AnchorActionProps) {
  const { t } = useTranslation("breakdown");
  const [open, setOpen] = useState(false);
  const [paths, setPaths] = useState<string[][] | null>(null);
  const [busy, setBusy] = useState(false);

  const anchored = row.anchor_status !== undefined;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || !workspaceRoot || paths !== null || busy) return;
    setBusy(true);
    void fetchEdgeHeadings(workspaceRoot, row.txf, row.input)
      .then((p) => setPaths(p))
      .finally(() => setBusy(false));
  };

  const apply = (path: string[]) => {
    if (!workspaceRoot || busy) return;
    setBusy(true);
    setOpen(false);
    void setEdgeAnchor(workspaceRoot, row.txf, row.input, path).finally(() =>
      setBusy(false),
    );
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
      {paths === null && <span className="breakdown-anchor__hint">{t("loading")}</span>}

      {paths !== null && paths.length === 0 && (
        <span className="breakdown-anchor__hint" data-testid="anchor-empty">
          {t("anchor.empty")}
        </span>
      )}

      {paths?.map((p, i) => (
        <button
          key={p.join("›")}
          type="button"
          className="breakdown-row__action"
          data-testid={`anchor-option-${i}`}
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
        onClick={() => setOpen(false)}
      >
        {t("lifecycle.cancel")}
      </button>
    </span>
  );
}
