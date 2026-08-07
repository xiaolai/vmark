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
import { useEffect, useState } from "react";
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
import {
  createContext,
  createContextFromBranch,
  refreshBranchCandidate,
  refreshBreakdown,
  refreshContexts,
  refreshMergeNotice,
  setContextEnforcement,
} from "@/services/breakdown/breakdownService";
import {
  refreshDelegations,
  refreshProvenance,
} from "@/services/breakdown/semanticActs";
import { SuppressedGroup } from "./SuppressedGroup";
import { LogbookSection } from "./LogbookSection";
import { DelegationsSection } from "./DelegationsSection";
import { MergeBanner } from "./MergeBanner";
import { ProvenanceGroup } from "./ProvenanceGroup";
import { ask } from "@tauri-apps/plugin-dialog";
import { BreakdownRow } from "./BreakdownRow";
import "./breakdown-panel.css";

/** Hard cap on listed edges — the count line reports the full total. */
export const RESULT_CAP = 200;

const DEFAULT_CONTEXT = "00000000-0000-0000-0000-000000000000";

export function BreakdownPanel() {
  const { t } = useTranslation("breakdown");
  const { t: tCommon } = useTranslation("common");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const rows = useBreakdownStore(selectRows);
  const loading = useBreakdownStore(selectLoading);
  const error = useBreakdownStore(selectError);

  const contexts = useBreakdownStore((s) => s.contexts);
  const selectedContext = useBreakdownStore((s) => s.selectedContext);
  const [newContextName, setNewContextName] = useState("");
  const branchCandidate = useBreakdownStore((s) => s.branchCandidate);

  useEffect(() => {
    if (rootPath) {
      void refreshContexts(rootPath);
      void refreshBreakdown(rootPath);
      void refreshProvenance(rootPath);
      void refreshDelegations(rootPath);
      void refreshBranchCandidate(rootPath);
      void refreshMergeNotice(rootPath);
    }
  }, [rootPath]);

  const selectContext = (id: string) => {
    // The default context's fixed nil id maps to null (= default).
    const normalized = id === DEFAULT_CONTEXT ? null : id;
    useBreakdownStore.getState().setSelectedContext(normalized);
    const root = useWorkspaceStore.getState().rootPath;
    if (root) void refreshBreakdown(root);
  };

  const addContext = () => {
    const name = newContextName.trim();
    const root = useWorkspaceStore.getState().rootPath;
    if (!root || name === "") return;
    setNewContextName("");
    void createContext(root, name);
  };

  const current = contexts.find((c) => c.id === (selectedContext ?? DEFAULT_CONTEXT));

  const switchToBranchContext = () => {
    if (!branchCandidate?.context) return;
    selectContext(branchCandidate.context);
  };
  const makeBranchContext = () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (root) void createContextFromBranch(root);
  };

  const toggleEnforce = async () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root || !current) return;
    const enforcing = current.enforcement !== "enforcing";
    if (enforcing) {
      // D4.3: enabling enforcement requires an explicit confirmation.
      const confirmed = await ask(t("contexts.enforceConfirm"), {
        title: t("contexts.enforceTitle"),
        kind: "warning",
      });
      if (!confirmed) return;
    }
    await setContextEnforcement(root, current.id, enforcing);
  };

  const refresh = () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (root) void refreshBreakdown(root);
  };
  const close = () => useBreakdownStore.getState().setPanelOpen(false);

  // Split on the Rust-computed verdict rather than re-deriving suppression
  // here — two consumers deriving it independently is exactly how the badge
  // and this list came to disagree. A row missing the field (written before
  // the field existed) counts as actionable: degrade toward interrupting.
  const actionable = rows.filter((r) => r.actionable !== false);
  const suppressed = rows.filter((r) => r.actionable === false);

  // The cap applies to the actionable list only. Capping the union would let a
  // pile of frozen edges push real work off the end of the panel.
  const capped = actionable.length > RESULT_CAP;
  const groups = selectRowsGroupedByArtifact(
    capped ? actionable.slice(0, RESULT_CAP) : actionable,
  );

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

      <MergeBanner />

      <div className="breakdown-context-bar">
        <label className="breakdown-context-bar__label">
          {t("contexts.label")}
          <select
            className="breakdown-context-bar__select"
            value={selectedContext ?? DEFAULT_CONTEXT}
            onChange={(e) => selectContext(e.target.value)}
          >
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.enforcement === "enforcing" ? " ⚑" : ""}
              </option>
            ))}
          </select>
        </label>
        {current && current.id !== DEFAULT_CONTEXT && (
          <button
            type="button"
            className="breakdown-row__action"
            onClick={() => void toggleEnforce()}
          >
            {current.enforcement === "enforcing"
              ? t("contexts.unenforce")
              : t("contexts.enforce")}
          </button>
        )}
        <input
          type="text"
          className="breakdown-context-bar__input"
          value={newContextName}
          onChange={(e) => setNewContextName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addContext();
          }}
          placeholder={t("contexts.newPlaceholder")}
          aria-label={t("contexts.newPlaceholder")}
        />
        {current?.errors.map((err) => (
          <div key={err} className="breakdown-context-bar__error" role="alert">
            {t("contexts.error", { error: err })}
          </div>
        ))}
      </div>

      {branchCandidate && (
        <div className="breakdown-branch-chip">
          {branchCandidate.ambiguous ? (
            <span className="breakdown-branch-chip__ambiguous" role="alert">
              {t("branch.ambiguous", { branch: branchCandidate.branch })}
            </span>
          ) : branchCandidate.context &&
            branchCandidate.context !== (selectedContext ?? DEFAULT_CONTEXT) ? (
            <button
              type="button"
              className="breakdown-branch-chip__switch"
              onClick={switchToBranchContext}
            >
              {t("branch.available", { name: branchCandidate.contextName })}
            </button>
          ) : branchCandidate.context === null ? (
            <button
              type="button"
              className="breakdown-branch-chip__create"
              onClick={makeBranchContext}
            >
              {t("branch.create", { branch: branchCandidate.branch })}
            </button>
          ) : null}
        </div>
      )}

      {error !== null && (
        <p className="breakdown-panel__error" role="alert">
          {t("error")}
          <span className="breakdown-panel__error-detail">{error}</span>
        </p>
      )}

      {loading && rows.length === 0 ? (
        <p className="breakdown-panel__loading">{t("loading")}</p>
      ) : actionable.length === 0 ? (
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
          {t("capNotice", { shown: RESULT_CAP, total: actionable.length })}
        </p>
      )}
      <SuppressedGroup rows={suppressed} workspaceRoot={rootPath} />
      <LogbookSection workspaceRoot={rootPath} />
      <ProvenanceGroup workspaceRoot={rootPath} />
      <DelegationsSection workspaceRoot={rootPath} />
    </div>
  );
}
