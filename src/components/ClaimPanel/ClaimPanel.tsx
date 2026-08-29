/**
 * ClaimPanel (WI-2b.6) — the minimal canon-claim surface: current claims
 * with their maturity, the four explicit lifecycle acts (design-2a.md
 * D2 — creation only via extract-from-selection, which hands a draft
 * statement to this panel), and the reversible default-context
 * visibility toggle (D2.4). Pull-based like the breakdown; nothing here
 * runs without an explicit human act.
 *
 * @coordinates-with services/claims/claimService.ts — the IPC seam
 * @coordinates-with services/commands/claimCommands.ts — extract + toggle
 * @module components/ClaimPanel/ClaimPanel
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClaimStore, type ClaimRow } from "@/stores/claimStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  performClaimAction,
  refreshClaims,
  scopeClaim,
} from "@/services/claims/claimService";
import "./claim-panel.css";
import { appError } from "@/utils/debug";

function ClaimItem({ row, workspaceRoot }: { row: ClaimRow; workspaceRoot: string }) {
  const { t } = useTranslation("claims");
  const [correcting, setCorrecting] = useState(false);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);

  const act = (request: Parameters<typeof performClaimAction>[1]) => {
    if (busy) return;
    setBusy(true);
    void performClaimAction(workspaceRoot, request).finally(() => setBusy(false));
  };

  const confirmCorrect = () => {
    const trimmed = statement.trim();
    if (trimmed === "") return;
    setCorrecting(false);
    setStatement("");
    act({ action: "correct", claim: row.claim, statement: trimmed });
  };

  return (
    <li className="claim-row">
      <div className="claim-row__main">
        <span className="claim-row__statement" title={row.statement}>
          {row.statement}
        </span>
        <span className={`claim-maturity-badge claim-maturity-badge--${row.maturity}`}>
          {t(`maturity.${row.maturity}`)}
        </span>
        {row.invalidAt !== null && (
          <span className="claim-ended-badge" title={row.invalidAt}>
            {t("ended")}
          </span>
        )}
        {!row.visible && (
          <span className="claim-hidden-badge">{t("hidden")}</span>
        )}
      </div>
      <div className="claim-row__actions">
        {row.maturity === "draft" && (
          <button
            type="button"
            className="claim-row__action"
            onClick={() => act({ action: "promote", claim: row.claim })}
            disabled={busy}
            title={t("promoteTitle")}
          >
            {t("actions.promote")}
          </button>
        )}
        <button
          type="button"
          className="claim-row__action"
          onClick={() => setCorrecting((c) => !c)}
          disabled={busy}
          aria-expanded={correcting}
        >
          {t("actions.correct")}
        </button>
        <button
          type="button"
          className="claim-row__action"
          onClick={() => act({ action: "retire", claim: row.claim })}
          disabled={busy || row.invalidAt !== null}
        >
          {t("actions.retire")}
        </button>
        <button
          type="button"
          className="claim-row__action"
          onClick={() => {
            setBusy(true);
            void scopeClaim(workspaceRoot, row.claim, !row.visible)
              .then(() => refreshClaims(workspaceRoot))
              .finally(() => setBusy(false));
          }}
          disabled={busy}
        >
          {row.visible ? t("actions.hide") : t("actions.show")}
        </button>
      </div>
      {correcting && (
        <div className="claim-row__correct">
          <input
            type="text"
            className="vm-input claim-row__correct-input"
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmCorrect();
            }}
            placeholder={t("correctPlaceholder")}
            aria-label={t("correctPlaceholder")}
          />
          <button
            type="button"
            className="claim-row__action"
            onClick={confirmCorrect}
            disabled={statement.trim() === ""}
          >
            {t("correctConfirm")}
          </button>
        </div>
      )}
    </li>
  );
}

function CreateForm({
  initial,
  sourcePath,
  workspaceRoot,
}: {
  initial: string;
  sourcePath: string;
  workspaceRoot: string;
}) {
  const { t } = useTranslation("claims");
  const [draft, setDraft] = useState(initial);

  const createClaim = () => {
    const trimmed = draft.trim();
    if (trimmed === "") return;
    useClaimStore.getState().setDraft(null, null);
    void performClaimAction(workspaceRoot, {
      action: "create",
      statement: trimmed,
      source_path: sourcePath,
    });
  };

  return (
    <div className="claim-panel__create">
      <div className="claim-panel__create-heading">{t("create.heading")}</div>
      <div className="claim-panel__create-source">
        {t("create.source", { path: sourcePath })}
      </div>
      <input
        type="text"
        className="vm-input claim-panel__create-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") createClaim();
        }}
        placeholder={t("create.statementPlaceholder")}
        aria-label={t("create.statementPlaceholder")}
      />
      <div className="claim-panel__create-actions">
        <button
          type="button"
          className="claim-row__action"
          onClick={createClaim}
          disabled={draft.trim() === ""}
        >
          {t("create.confirm")}
        </button>
        <button
          type="button"
          className="claim-row__action"
          onClick={() => useClaimStore.getState().setDraft(null, null)}
        >
          {t("create.cancel")}
        </button>
      </div>
    </div>
  );
}

export function ClaimPanel() {
  const { t } = useTranslation("claims");
  const rows = useClaimStore((s) => s.rows);
  const loading = useClaimStore((s) => s.loading);
  const error = useClaimStore((s) => s.error);
  const draftStatement = useClaimStore((s) => s.draftStatement);
  const draftSourcePath = useClaimStore((s) => s.draftSourcePath);
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath);

  useEffect(() => {
    if (workspaceRoot) void refreshClaims(workspaceRoot);
  }, [workspaceRoot]);

  return (
    <div className="vm-overlay__panel claim-panel">
      <div className="vm-panel__header claim-panel__header">
        <span className="claim-panel__title">{t("title")}</span>
        <div className="claim-panel__actions">
          <button
            type="button"
            className="vm-icon-btn vm-icon-btn--sm"
            onClick={() => { if (workspaceRoot) void refreshClaims(workspaceRoot).catch((e) => appError("Failed to refresh claims:", e)); }}
            aria-label={t("refresh")}
            title={t("refresh")}
          >
            ⟳
          </button>
          <button
            type="button"
            className="vm-icon-btn vm-icon-btn--sm"
            onClick={() => useClaimStore.getState().setPanelOpen(false)}
            aria-label={t("close")}
            title={t("close")}
          >
            ✕
          </button>
        </div>
      </div>
      {error !== null && <div className="claim-panel__error">{t("error")}: {error}</div>}
      {draftStatement !== null && draftSourcePath !== null && workspaceRoot && (
        <CreateForm
          key={draftStatement}
          initial={draftStatement}
          sourcePath={draftSourcePath}
          workspaceRoot={workspaceRoot}
        />
      )}
      {loading && rows.length === 0 && (
        <div className="claim-panel__loading">{t("loading")}</div>
      )}
      {!loading && rows.length === 0 && draftStatement === null && (
        <div className="claim-panel__empty">{t("empty")}</div>
      )}
      {rows.length > 0 && workspaceRoot && (
        <ul className="claim-panel__list">
          {rows.map((row) => (
            <ClaimItem key={row.claim} row={row} workspaceRoot={workspaceRoot} />
          ))}
        </ul>
      )}
    </div>
  );
}
