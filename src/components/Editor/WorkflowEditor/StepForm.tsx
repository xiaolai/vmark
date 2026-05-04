/**
 * Purpose: Edit form for one step inside a job. Handles both `uses:`
 *   and `run:` step kinds. The `with:` block renders as key/value
 *   rows; users can add, edit, or remove individual keys, each
 *   producing a typed IRPatch.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 7 / WI-7.1 + WI-7.2.
 *
 * Key decisions:
 *   - `uses:` is read-only in this form (Phase 7). Changing the action
 *     reference is a structural edit better expressed in source until
 *     a dedicated action picker exists.
 *   - `with:` rows hold local state; on blur or the "remove" button
 *     they emit one with.set or with.remove patch each. Rename of an
 *     existing key emits a remove + a set, which is exactly what the
 *     mutator needs.
 *   - Action-metadata-driven field discovery (Phase 6 registry) is
 *     deferred to Phase 9 polish — the registry exists but threading
 *     the async fetch through this synchronous form needs more design.
 *
 * @coordinates-with src/stores/workflowEditStore.ts — IRPatch sink
 * @module components/Editor/WorkflowEditor/StepForm
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { StepIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { useActionMetadata } from "./useActionMetadata";
import { ExpressionEditor } from "./ExpressionEditor";
import "./workflow-editor.css";

type ExpandTarget = null | { field: "if" | "run"; value: string };

interface StepFormProps {
  jobId: string;
  stepIndex: number;
  step: StepIR;
}

interface WithRow {
  key: string;
  value: string;
  /** Original key when this row was loaded from IR; null for newly added rows. */
  originalKey: string | null;
}

function withRowsFromStep(step: StepIR): WithRow[] {
  if (!step.with) return [];
  return Object.entries(step.with).map(([key, value]) => ({
    key,
    value: value == null ? "" : String(value),
    originalKey: key,
  }));
}

export function StepForm({
  jobId,
  stepIndex,
  step,
}: StepFormProps): ReactElement {
  const { t } = useTranslation("workflowEditor");

  const [name, setName] = useState(step.name ?? "");
  const [run, setRun] = useState(step.run ?? "");
  const [workingDir, setWorkingDir] = useState(step.workingDirectory ?? "");
  const [ifCond, setIfCond] = useState(step.if ?? "");
  const [withRows, setWithRows] = useState<WithRow[]>(withRowsFromStep(step));
  const [expand, setExpand] = useState<ExpandTarget>(null);

  const queue = useWorkflowEditStore((s) => s.queuePatch);

  const handleExpandSave = (value: string): void => {
    if (!expand) return;
    if (expand.field === "if") {
      setIfCond(value);
      if (value !== (step.if ?? "")) {
        queue({ kind: "step.set", jobId, stepIndex, path: "if", value });
      }
    } else {
      setRun(value);
      if (value !== (step.run ?? "")) {
        queue({ kind: "step.set", jobId, stepIndex, path: "run", value });
      }
    }
    setExpand(null);
  };

  // Action metadata for the structured `with:` UI. Idle for run-steps;
  // unavailable falls back to the existing free-form rows so the form
  // stays usable even when the registry can't reach GitHub.
  const metadataResult = useActionMetadata(step.uses);
  const inputs =
    metadataResult.state === "success"
      ? metadataResult.metadata.inputs
      : null;
  const setKeys = new Set(withRows.map((r) => r.key));
  const missingRequired = inputs
    ? Object.entries(inputs).filter(
        ([key, schema]) => schema.required && !setKeys.has(key),
      )
    : [];

  const addSuggestedKey = (key: string): void => {
    setWithRows((rows) =>
      rows.some((r) => r.key === key)
        ? rows
        : [...rows, { key, value: "", originalKey: null }],
    );
  };

  const commitField = (path: string, next: string, original: string): void => {
    if (next === original) return;
    queue({ kind: "step.set", jobId, stepIndex, path, value: next });
  };

  const commitWithRow = (row: WithRow): void => {
    if (!row.key) return;
    if (row.originalKey && row.originalKey !== row.key) {
      // Renamed: remove the old key, set the new one.
      queue({
        kind: "with.remove",
        jobId,
        stepIndex,
        key: row.originalKey,
      });
    }
    queue({
      kind: "with.set",
      jobId,
      stepIndex,
      key: row.key,
      value: row.value,
    });
  };

  const updateRow = (idx: number, patch: Partial<WithRow>): void => {
    setWithRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  const removeRow = (idx: number): void => {
    const row = withRows[idx];
    if (row.originalKey) {
      queue({
        kind: "with.remove",
        jobId,
        stepIndex,
        key: row.originalKey,
      });
    }
    setWithRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const addRow = (): void => {
    setWithRows((rows) => [...rows, { key: "", value: "", originalKey: null }]);
  };

  return (
    <form className="workflow-form" onSubmit={(e) => e.preventDefault()}>
      <header className="workflow-form__header">
        <span className="workflow-form__kind">{t("form.step.kind")}</span>
        <code className="workflow-form__id">{step.id}</code>
      </header>

      <label className="workflow-form__field">
        <span className="workflow-form__label">{t("form.step.name.label")}</span>
        <input
          className="workflow-form__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commitField("name", name, step.name ?? "")}
        />
      </label>

      {step.uses && (
        <div className="workflow-form__field">
          <span className="workflow-form__label">{t("form.step.uses.label")}</span>
          <code className="workflow-form__id">{step.uses}</code>
        </div>
      )}

      {step.run !== undefined && (
        <label className="workflow-form__field">
          <span className="workflow-form__label">{t("form.step.run.label")}</span>
          <textarea
            className="workflow-form__input workflow-form__input--mono"
            rows={3}
            value={run}
            onChange={(e) => setRun(e.target.value)}
            onBlur={() => commitField("run", run, step.run ?? "")}
          />
          <button
            type="button"
            className="workflow-form__expand-btn"
            onClick={() => setExpand({ field: "run", value: run })}
          >
            {t("expression.expand.run")}
          </button>
        </label>
      )}

      <label className="workflow-form__field">
        <span className="workflow-form__label">
          {t("form.step.workingDirectory.label")}
        </span>
        <input
          className="workflow-form__input workflow-form__input--mono"
          type="text"
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          onBlur={() =>
            commitField(
              "working-directory",
              workingDir,
              step.workingDirectory ?? "",
            )
          }
        />
      </label>

      <label className="workflow-form__field">
        <span className="workflow-form__label">{t("form.step.if.label")}</span>
        <textarea
          className="workflow-form__input workflow-form__input--mono"
          rows={2}
          value={ifCond}
          onChange={(e) => setIfCond(e.target.value)}
          onBlur={() => commitField("if", ifCond, step.if ?? "")}
        />
        <button
          type="button"
          className="workflow-form__expand-btn"
          onClick={() => setExpand({ field: "if", value: ifCond })}
        >
          {t("expression.expand.if")}
        </button>
      </label>

      {(step.uses || withRows.length > 0) && (
        <div className="workflow-form__field">
          <span className="workflow-form__label">
            {t("form.step.with.label")}
          </span>
          {metadataResult.state === "loading" && (
            <span className="workflow-form__metadata-loading">
              {t("panel.metadata.fetching")}
            </span>
          )}
          {metadataResult.state === "unavailable" && (
            <span className="workflow-form__metadata-loading">
              {t("panel.metadata.unavailable")}
            </span>
          )}
          <div className="workflow-form__with-rows">
            {withRows.map((row, idx) => {
              const schema = inputs?.[row.key];
              return (
                <div key={idx} className="workflow-form__with-row-group">
                  <div className="workflow-form__with-row">
                    <input
                      className="workflow-form__input workflow-form__input--mono"
                      type="text"
                      value={row.key}
                      placeholder={t("form.step.with.keyPlaceholder")}
                      onChange={(e) => updateRow(idx, { key: e.target.value })}
                      onBlur={() => commitWithRow(withRows[idx])}
                    />
                    <input
                      className="workflow-form__input workflow-form__input--mono"
                      type="text"
                      value={row.value}
                      placeholder={
                        schema?.default ?? t("form.step.with.valuePlaceholder")
                      }
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      onBlur={() => commitWithRow(withRows[idx])}
                    />
                    <button
                      type="button"
                      className="workflow-form__with-remove"
                      aria-label={t("form.step.with.removeRow")}
                      onClick={() => removeRow(idx)}
                    >
                      ×
                    </button>
                  </div>
                  {schema?.description && (
                    <span className="workflow-form__metadata-desc">
                      {schema.description}
                    </span>
                  )}
                </div>
              );
            })}
            {missingRequired.length > 0 && (
              <div className="workflow-form__missing-required">
                <span className="workflow-form__label">
                  {t("form.step.with.missingRequired")}
                </span>
                {missingRequired.map(([key, schema]) => (
                  <button
                    key={key}
                    type="button"
                    className="workflow-form__missing-required-key"
                    onClick={() => addSuggestedKey(key)}
                    title={schema.description ?? ""}
                  >
                    <code>{key}</code>
                    <span aria-label="required">*</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="workflow-form__with-add"
              onClick={addRow}
            >
              + {t("form.step.with.addRow")}
            </button>
          </div>
        </div>
      )}
      {expand && (
        <ExpressionEditor
          initialValue={expand.value}
          language={expand.field === "if" ? "yaml" : "plain"}
          title={t(
            expand.field === "if"
              ? "expression.title.if"
              : "expression.title.run",
          )}
          onSave={handleExpandSave}
          onCancel={() => setExpand(null)}
        />
      )}
    </form>
  );
}
