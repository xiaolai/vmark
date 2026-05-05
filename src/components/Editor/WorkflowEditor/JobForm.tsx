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
import { Trash2, ChevronUp, ChevronDown, Plus } from "lucide-react";
import type { JobIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
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
  const cancel = useWorkflowEditStore((s) => s.cancelPatchForTarget);

  const commitIfChanged = (
    path: string,
    next: string,
    original: string,
  ): void => {
    if (next === original) {
      // Revert to original IR value: drop any earlier patch for this
      // target. Without this, typing A → B → A leaves the A→B patch
      // queued, persisting B on Save (cross-validator audit finding).
      cancel({ kind: "job.set", jobId: job.id, path, value: "" });
      return;
    }
    // runs-on must round-trip as an array when the user provided
    // multiple labels (e.g., self-hosted runner selectors:
    // ["self-hosted", "linux", "x64"]). Without the split, the save
    // path would write a single scalar string with the " / " separator
    // baked in, corrupting the runner selector (cross-validator audit
    // finding).
    if (path === "runs-on") {
      const labels = next.split("/").map((s) => s.trim()).filter(Boolean);
      const value: string | string[] =
        labels.length > 1 ? labels : labels[0] ?? "";
      queue({
        kind: "job.set",
        jobId: job.id,
        path,
        value,
      });
      return;
    }
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
        <button
          type="button"
          className="workflow-form__danger-btn"
          onClick={() => {
            const ok = window.confirm(
              t("form.job.delete.confirm", {
                defaultValue: "Delete job '{{id}}'? This cannot be undone before save.",
                id: job.id,
              }),
            );
            if (!ok) return;
            queue({ kind: "job.delete", jobId: job.id });
            useWorkflowViewStore.getState().clearSelection();
          }}
          aria-label={t("form.job.delete.label", {
            defaultValue: "Delete job",
          })}
          title={t("form.job.delete.label", { defaultValue: "Delete job" })}
        >
          <Trash2 size={14} />
        </button>
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

      <section
        className="workflow-form__step-list"
        aria-label={t("form.job.steps.navigation")}
      >
        <div className="workflow-form__step-list-header">
          <span className="workflow-form__label">
            {t("form.job.steps.label")}
          </span>
          <button
            type="button"
            className="workflow-form__step-add-btn"
            onClick={() =>
              queue({
                kind: "step.insert",
                jobId: job.id,
                index: job.steps.length,
                step: {},
              })
            }
            aria-label={t("form.job.steps.add", {
              defaultValue: "Add step",
            })}
            title={t("form.job.steps.add", { defaultValue: "Add step" })}
          >
            <Plus size={14} />
          </button>
        </div>
        {job.steps.length > 0 && (
          <ul className="workflow-form__step-rows">
            {job.steps.map((step, idx) => {
              const label = step.name ?? step.uses ?? step.id;
              const isFirst = idx === 0;
              const isLast = idx === job.steps.length - 1;
              return (
                <li key={step.id} className="workflow-form__step-row-group">
                  <button
                    type="button"
                    className="workflow-form__step-row"
                    onClick={() =>
                      useWorkflowViewStore.getState().selectStep(job.id, step.id)
                    }
                  >
                    <span className="workflow-form__step-row-label">
                      {label}
                    </span>
                    {step.uses && step.name && (
                      <code className="workflow-form__step-row-uses">
                        {step.uses}
                      </code>
                    )}
                  </button>
                  <button
                    type="button"
                    className="workflow-form__step-action-btn"
                    disabled={isFirst}
                    onClick={() =>
                      queue({
                        kind: "step.move",
                        jobId: job.id,
                        fromIndex: idx,
                        toIndex: idx - 1,
                      })
                    }
                    aria-label={t("form.job.steps.moveUp", {
                      defaultValue: "Move step up",
                    })}
                    title={t("form.job.steps.moveUp", {
                      defaultValue: "Move step up",
                    })}
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    className="workflow-form__step-action-btn"
                    disabled={isLast}
                    onClick={() =>
                      queue({
                        kind: "step.move",
                        jobId: job.id,
                        fromIndex: idx,
                        toIndex: idx + 1,
                      })
                    }
                    aria-label={t("form.job.steps.moveDown", {
                      defaultValue: "Move step down",
                    })}
                    title={t("form.job.steps.moveDown", {
                      defaultValue: "Move step down",
                    })}
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    type="button"
                    className="workflow-form__step-action-btn workflow-form__step-action-btn--danger"
                    onClick={() => {
                      const ok = window.confirm(
                        t("form.job.steps.deleteConfirm", {
                          defaultValue: "Delete step '{{label}}'?",
                          label,
                        }),
                      );
                      if (!ok) return;
                      queue({
                        kind: "step.delete",
                        jobId: job.id,
                        stepIndex: idx,
                      });
                    }}
                    aria-label={t("form.job.steps.delete", {
                      defaultValue: "Delete step",
                    })}
                    title={t("form.job.steps.delete", {
                      defaultValue: "Delete step",
                    })}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </form>
  );
}
