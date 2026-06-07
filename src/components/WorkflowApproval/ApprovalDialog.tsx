/**
 * Workflow Approval Dialog
 *
 * Purpose: Renders a modal when the runner emits `workflow:approval-request`.
 * Shows the genie summary, the resolved model, and a 500-char prompt preview.
 * The user clicks Approve or Deny; the verdict goes back through
 * `respond_workflow_approval` and dismisses the dialog.
 *
 * Esc = Deny (consistent with VMark's other dialogs).
 *
 * @coordinates-with workflowApprovalStore.ts — reads `pending`
 * @coordinates-with useWorkflowExecution.ts — calls `respondApproval`
 * @module components/WorkflowApproval/ApprovalDialog
 */

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useWorkflowStore } from "@/stores/workflowStore";
import { useWorkflowExecution } from "@/hooks/useWorkflowExecution";
import { workflowError } from "@/utils/debug";

import "./approval-dialog.css";

export function ApprovalDialog() {
  const { t } = useTranslation();
  const pending = useWorkflowStore((s) => s.approval.pending);
  const { respondApproval } = useWorkflowExecution();

  // RW-2 (L4) — fail-loud on approval IPC rejection
  const respond = useCallback(
    async (approved: boolean) => {
      const current = useWorkflowStore.getState().approval.pending;
      if (!current) return;
      try {
        await respondApproval(current.executionId, current.stepId, approved);
      } catch (error) {
        // The IPC verdict failed. Log loudly instead of letting the
        // fire-and-forget caller surface an unhandled rejection.
        workflowError("Failed to respond to workflow approval:", error);
      } finally {
        useWorkflowStore.getState().dismissApproval();
      }
    },
    [respondApproval],
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void respond(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, respond]);

  if (!pending) return null;

  return (
    <div className="approval-dialog__backdrop" role="presentation">
      <div
        className="approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-dialog-title"
      >
        <h2 id="approval-dialog-title" className="approval-dialog__title">
          {t("workflow:approval.title", "Approve workflow step?")}
        </h2>
        <dl className="approval-dialog__meta">
          <div className="approval-dialog__meta-row">
            <dt>{t("workflow:approval.step", "Step")}</dt>
            <dd>
              <code>{pending.summary}</code>
            </dd>
          </div>
          {pending.model ? (
            <div className="approval-dialog__meta-row">
              <dt>{t("workflow:approval.model", "Model")}</dt>
              <dd>
                <code>{pending.model}</code>
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="approval-dialog__preview-label">
          {t("workflow:approval.preview", "Prompt preview")}
        </div>
        <pre className="approval-dialog__preview">{pending.preview || "—"}</pre>
        <div className="approval-dialog__actions">
          <button
            type="button"
            className="approval-dialog__btn approval-dialog__btn--deny"
            onClick={() => void respond(false)}
          >
            {t("workflow:approval.deny", "Deny")}
          </button>
          <button
            type="button"
            className="approval-dialog__btn approval-dialog__btn--approve"
            onClick={() => void respond(true)}
            autoFocus
          >
            {t("workflow:approval.approve", "Approve")}
          </button>
        </div>
      </div>
    </div>
  );
}
