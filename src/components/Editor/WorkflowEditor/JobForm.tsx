/**
 * Purpose: Edit form for one GitHub Actions job. Reads from the IR and
 *   emits IRPatches into `workflowEditStore` on field commit (blur or
 *   Enter). The store accumulates the patches; the panel's Save button
 *   serializes them through the Phase 8 CST mutator pipeline.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 7 / WI-7.1 + WI-7.2.
 *
 * Key decisions:
 *   - Patches are emitted on blur, not on every keystroke — keeps the
 *     queue compact and lets users abandon a half-edit by tabbing away
 *     to the same value.
 *   - Read-only summary (needs[], step count) lives at the bottom so
 *     the form's primary action affordances stay above the fold.
 *   - Field-level CodeMirror "expand" is a Phase 9 polish item; for
 *     now `if:` is a textarea. Free-form text on expression fields is
 *     consistent with the plan: expressions stay text — "no attempt to
 *     GUI them".
 *
 * @coordinates-with src/stores/workflowEditStore.ts — IRPatch sink
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — patch shape
 * @module components/Editor/WorkflowEditor/JobForm
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { JobIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import "./workflow-editor.css";

interface JobFormProps {
  job: JobIR;
}

export function JobForm({ job }: JobFormProps): ReactElement {
  const { t } = useTranslation("workflowEditor");

  const [name, setName] = useState(job.name ?? "");
  const [runsOn, setRunsOn] = useState(job.runsOn?.join(" / ") ?? "");
  const [ifCond, setIfCond] = useState(job.if ?? "");

  const queue = useWorkflowEditStore((s) => s.queuePatch);

  const commitIfChanged = (
    path: string,
    next: string,
    original: string,
  ): void => {
    if (next === original) return;
    queue({
      kind: "job.set",
      jobId: job.id,
      path,
      value: next,
    });
  };

  return (
    <form className="workflow-form" onSubmit={(e) => e.preventDefault()}>
      <header className="workflow-form__header">
        <span className="workflow-form__kind">{t("form.job.kind")}</span>
        <code className="workflow-form__id">{job.id}</code>
      </header>

      <label className="workflow-form__field">
        <span className="workflow-form__label">{t("form.job.name.label")}</span>
        <input
          className="workflow-form__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commitIfChanged("name", name, job.name ?? "")}
          placeholder={t("form.job.name.placeholder")}
        />
      </label>

      <label className="workflow-form__field">
        <span className="workflow-form__label">
          {t("form.job.runsOn.label")}
        </span>
        <input
          className="workflow-form__input"
          type="text"
          value={runsOn}
          onChange={(e) => setRunsOn(e.target.value)}
          onBlur={() =>
            commitIfChanged("runs-on", runsOn, job.runsOn?.join(" / ") ?? "")
          }
          placeholder={t("form.job.runsOn.placeholder")}
        />
      </label>

      <label className="workflow-form__field">
        <span className="workflow-form__label">{t("form.job.if.label")}</span>
        <textarea
          className="workflow-form__input workflow-form__input--mono"
          value={ifCond}
          rows={2}
          onChange={(e) => setIfCond(e.target.value)}
          onBlur={() => commitIfChanged("if", ifCond, job.if ?? "")}
          placeholder="github.event_name == 'push'"
        />
      </label>

      <section className="workflow-form__summary">
        <span className="workflow-form__summary-row">
          {t("form.job.steps.count", { count: job.steps.length })}
        </span>
        {job.needs.length > 0 && (
          <span className="workflow-form__summary-row">
            <span className="workflow-form__summary-label">
              {t("form.job.needs.label")}:
            </span>{" "}
            {job.needs.map((n) => (
              <code key={n} className="workflow-form__needs-chip">
                {n}
              </code>
            ))}
          </span>
        )}
        {job.uses && (
          <span className="workflow-form__summary-row">
            <span className="workflow-form__summary-label">
              {t("form.job.uses.label")}:
            </span>{" "}
            <code>{job.uses}</code>
          </span>
        )}
      </section>
    </form>
  );
}
