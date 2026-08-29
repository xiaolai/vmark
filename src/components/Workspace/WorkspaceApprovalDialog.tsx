/**
 * WorkspaceApprovalDialog — the human half of the open_workspace consent model
 * (plan WI-2.1). The enforcement half (one-shot bound to canonical path + window
 * + client, no standing grant) lives in workspaceApprovalStore; this renders the
 * pending request and calls resolveApproval so the AI's retry can proceed.
 *
 * It names the CANONICAL folder path (resolved by Rust — Codex F-06), because
 * that is exactly what the one-shot authorizes and what file tree the agent is
 * being granted. Fail-closed: Escape denies and Deny holds focus, so a stray
 * Enter can never authorize opening a folder. No "remember" option — a standing
 * grant to open any folder would defeat the approval (ADR-2).
 *
 * @coordinates-with stores/workspaceApprovalStore — pending queue + resolveApproval
 * @module components/Workspace/WorkspaceApprovalDialog
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceApprovalStore } from "@/stores/workspaceApprovalStore";
import { OCCLUDER } from "@/services/browser/browserOcclusion";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";
import "./workspace-approval-dialog.css";

export function WorkspaceApprovalDialog() {
  const { t } = useTranslation("dialog");
  const pending = useWorkspaceApprovalStore((s) => s.pending[0]);
  const resolveApproval = useWorkspaceApprovalStore((s) => s.resolveApproval);
  const denyRef = useRef<HTMLButtonElement>(null);

  // The native browser view paints over React DOM, so freeze it while this
  // consent prompt is up (matches ApprovalDialog; overlay-policy invariant).
  useBrowserOccluder(Boolean(pending), OCCLUDER.workspaceApproval);

  // Fail-closed: focus Deny so a stray Enter denies; Escape denies too.
  useEffect(() => {
    if (pending) denyRef.current?.focus();
  }, [pending]);

  if (!pending) return null;

  const deny = () => resolveApproval(pending.id, "deny");
  const approve = () => resolveApproval(pending.id, "approve");

  return (
    <div
      className="vm-overlay vm-overlay--center workspace-approval-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-approval-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") deny();
      }}
      onClick={(e) => {
        // Backdrop dismissal = deny (fail-closed): a click outside the dialog
        // must not leave the prompt lingering and later approvable. Clicks on
        // the dialog body/buttons have e.target !== the overlay, so they don't
        // deny (the buttons' own handlers run).
        if (e.target === e.currentTarget) deny();
      }}
    >
      <div className="vm-overlay__panel workspace-approval-dialog">
        <h2 id="workspace-approval-title" className="workspace-approval-title">
          {t("openWorkspace.approval.title")}
        </h2>
        <p className="workspace-approval-body">{t("openWorkspace.approval.body")}</p>
        <code className="workspace-approval-path">{pending.canonicalPath}</code>
        <div className="workspace-approval-actions">
          <button ref={denyRef} type="button" className="vm-btn" onClick={deny}>
            {t("openWorkspace.approval.deny")}
          </button>
          <button type="button" className="vm-btn vm-btn--primary" onClick={approve}>
            {t("openWorkspace.approval.approve")}
          </button>
        </div>
      </div>
    </div>
  );
}
