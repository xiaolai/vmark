/**
 * BreakdownPanel (WI-1.9b) — pull-based list of the workspace's live
 * stale/diverged dependency edges, grouped by downstream artifact, with the
 * three resolution actions (accept-newer / revise / waive — spec §9.2).
 *
 * Presentational + thin behavior: reads the mirror from `breakdownStore`
 * and delegates every mutation to `breakdownService`. Pull-based (R15):
 * the panel mounts only while open, so the mount effect IS the
 * refresh-on-open; there is no background polling.
 *
 * @module components/BreakdownPanel/BreakdownPanel
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, X } from "lucide-react";
import {
  useBreakdownStore,
  selectRows,
  selectLoading,
  selectError,
  selectRowsGroupedByArtifact,
} from "@/stores/breakdownStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { refreshBreakdown } from "@/services/breakdown/breakdownService";
import { BreakdownRow } from "./BreakdownRow";
import "./breakdown-panel.css";

/** Hard cap on listed edges — the count line reports the full total. */
export const RESULT_CAP = 200;

export function BreakdownPanel() {
  const { t } = useTranslation("breakdown");
  const { t: tCommon } = useTranslation("common");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const rows = useBreakdownStore(selectRows);
  const loading = useBreakdownStore(selectLoading);
  const error = useBreakdownStore(selectError);

  useEffect(() => {
    if (rootPath) void refreshBreakdown(rootPath);
  }, [rootPath]);

  const refresh = () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (root) void refreshBreakdown(root);
  };
  const close = () => useBreakdownStore.getState().setPanelOpen(false);

  const capped = rows.length > RESULT_CAP;
  const groups = selectRowsGroupedByArtifact(capped ? rows.slice(0, RESULT_CAP) : rows);

  return (
    <div
      className="breakdown-panel"
      role="dialog"
      aria-label={t("title")}
      data-testid="breakdown-panel"
    >
      <header className="breakdown-panel__header">
        <span className="breakdown-panel__title">{t("title")}</span>
        <div className="breakdown-panel__actions">
          <button
            type="button"
            className="breakdown-panel__icon-btn"
            onClick={refresh}
            disabled={loading || !rootPath}
            title={t("refresh")}
            aria-label={t("refresh")}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="breakdown-panel__icon-btn"
            onClick={close}
            title={tCommon("close")}
            aria-label={tCommon("close")}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {error !== null && (
        <p className="breakdown-panel__error" role="alert">
          {t("error")}
          <span className="breakdown-panel__error-detail">{error}</span>
        </p>
      )}

      {loading && rows.length === 0 ? (
        <p className="breakdown-panel__loading">{t("loading")}</p>
      ) : rows.length === 0 ? (
        error === null && <p className="breakdown-panel__empty">{t("empty")}</p>
      ) : (
        <div className="breakdown-panel__groups">
          {groups.map((group) => (
            <section key={group.artifact} className="breakdown-group">
              <h3 className="breakdown-group__artifact" title={group.artifact}>
                {group.artifact}
              </h3>
              <ul className="breakdown-group__list">
                {group.rows.map((row) => (
                  <BreakdownRow
                    key={`${row.txf}#${row.input}`}
                    row={row}
                    workspaceRoot={rootPath}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {capped && (
        <p className="breakdown-panel__cap">
          {t("capNotice", { shown: RESULT_CAP, total: rows.length })}
        </p>
      )}
    </div>
  );
}
