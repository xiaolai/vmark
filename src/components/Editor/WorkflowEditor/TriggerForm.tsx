/**
 * Purpose: Read-only summary view of a workflow's `on:` triggers.
 *   Renders the event name and any associated filters (branches,
 *   tags, paths, cron, types) as a compact list. Editing triggers is
 *   deferred — their structure is dense and easy to render
 *   incorrectly via single-line text inputs, so Phase 7 only reads.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 7 / WI-7.1.
 *
 * @module components/Editor/WorkflowEditor/TriggerForm
 */

import { type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TriggerIR } from "@/lib/ghaWorkflow/types";
import "./workflow-editor.css";

interface TriggerFormProps {
  triggers: TriggerIR[];
}

export function TriggerForm({ triggers }: TriggerFormProps): ReactElement {
  const { t } = useTranslation("workflowEditor");

  if (triggers.length === 0) {
    return (
      <div className="workflow-editor-panel__empty">
        {t("form.trigger.empty")}
      </div>
    );
  }

  return (
    <section className="workflow-form">
      <header className="workflow-form__header">
        <span className="workflow-form__kind">{t("form.trigger.kind")}</span>
      </header>
      <ul className="workflow-form__trigger-list">
        {triggers.map((tr, idx) => (
          <li key={idx} className="workflow-form__trigger-item">
            <span className="workflow-form__trigger-event">{tr.event}</span>
            <div className="workflow-form__trigger-meta">
              {tr.branches && tr.branches.length > 0 && (
                <span>
                  {t("form.trigger.branches", { value: tr.branches.join(", ") })}
                </span>
              )}
              {tr.branchesIgnore && tr.branchesIgnore.length > 0 && (
                <span>
                  {t("form.trigger.branchesIgnore", {
                    value: tr.branchesIgnore.join(", "),
                  })}
                </span>
              )}
              {tr.tags && tr.tags.length > 0 && (
                <span>{t("form.trigger.tags", { value: tr.tags.join(", ") })}</span>
              )}
              {tr.paths && tr.paths.length > 0 && (
                <span>
                  {t("form.trigger.paths", { value: tr.paths.join(", ") })}
                </span>
              )}
              {tr.cron && (
                <span>{t("form.trigger.cron", { value: tr.cron })}</span>
              )}
              {tr.types && tr.types.length > 0 && (
                <span>
                  {t("form.trigger.types", { value: tr.types.join(", ") })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
