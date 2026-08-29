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
 *   - `with:` rows hold local state; blur commits via the pure plans in
 *     withRowPlans.ts (rename = remove + set, chains cancel intermediate
 *     keys, duplicate keys are rejected with an inline error). Removing a
 *     row cancels its queued sets and queues with.remove for its original
 *     key, so a deleted row never writes back on Save.
 *   - Action-metadata-driven field discovery (Phase 6 registry) is
 *     deferred to Phase 9 polish — the registry exists but threading
 *     the async fetch through this synchronous form needs more design.
 *
 * @coordinates-with src/stores/workflowEditStore.ts — IRPatch sink
 * @module components/Editor/WorkflowEditor/StepForm
 */

import { useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ArrowUp } from "lucide-react";
import type { StepIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useActionMetadata } from "./useActionMetadata";
import { ExpressionEditor } from "./ExpressionEditor";
import {
  newWithRow,
  planWithRowCommit,
  planWithRowRemoval,
  withRowsFromStep,
  type WithRow,
} from "./withRowPlans";
import "./workflow-editor.css";

type ExpandTarget = null | { field: "if" | "run"; value: string };

interface StepFormProps {
  jobId: string;
  stepIndex: number;
  step: StepIR;
  /** Total number of steps in this job — used to render N of M.
   *  Optional for unit tests that render the form in isolation; production
   *  callers (WorkflowEditorPanel) always provide it. Defaults to
   *  `stepIndex + 1` so the position label degrades to "Step N of N". */
  stepCount?: number;
  /** Step id to navigate to with Prev. null/undefined disables the button. */
  prevStepId?: string | null;
  /** Step id to navigate to with Next. null/undefined disables the button. */
  nextStepId?: string | null;
}

export function StepForm({
  jobId,
  stepIndex,
  step,
  stepCount,
  prevStepId = null,
  nextStepId = null,
}: StepFormProps): ReactElement {
  const totalSteps = stepCount ?? stepIndex + 1;
  const { t } = useTranslation("workflowEditor");

  const goToStep = (stepId: string | null): void => {
    if (!stepId) return;
    useWorkflowStore.getState().selectStep(jobId, stepId);
  };
  const backToJob = (): void => {
    useWorkflowStore.getState().selectJob(jobId);
  };

  // Focus restoration after a step→step navigation remount is owned by
  // WorkflowEditorPanel: a remounted StepForm has no memory of whether the
  // mount came from user nav, so the panel observes selectedStepId
  // transitions and reaches into the fresh DOM via querySelector to land
  // focus on the appropriate nav button.

  // Keyboard nav: Alt+Left / Alt+Right walk steps. Listens on the
  // window so the form doesn't have to be focused — accessible from
  // anywhere within the side panel context. Bails out when the user
  // is typing in an editable element so we don't steal native
  // word-navigation (Alt+Arrow on macOS) or any child shortcut that
  // already called preventDefault.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey) return;
      if (e.defaultPrevented) return;
      // Skip when focus is inside an editable surface (input, textarea,
      // contenteditable host, or CodeMirror). These all need the native
      // Alt+Arrow word-jump and would silently lose it otherwise.
      // The instanceof check handles Window/Document/null targets that
      // don't expose tagName/closest/isContentEditable.
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable ||
          target.closest(".cm-editor")
        ) {
          return;
        }
      }
      if (e.key === "ArrowLeft" && prevStepId) {
        e.preventDefault();
        goToStep(prevStepId);
      } else if (e.key === "ArrowRight" && nextStepId) {
        e.preventDefault();
        goToStep(nextStepId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // jobId is captured into goToStep via useWorkflowStore.getState();
    // we only need to refresh the listener when prev/next change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevStepId, nextStepId]);

  const [name, setName] = useState(step.name ?? "");
  const [run, setRun] = useState(step.run ?? "");
  const [workingDir, setWorkingDir] = useState(step.workingDirectory ?? "");
  const [ifCond, setIfCond] = useState(step.if ?? "");
  const [withRows, setWithRows] = useState<WithRow[]>(withRowsFromStep(step));
  const [expand, setExpand] = useState<ExpandTarget>(null);

  const queue = useWorkflowStore((s) => s.queuePatch);
  const cancel = useWorkflowStore((s) => s.cancelPatchForTarget);

  const handleExpandSave = (value: string): void => {
    if (!expand) return;
    if (expand.field === "if") {
      setIfCond(value);
      if (value !== (step.if ?? "")) {
        queue({ kind: "step.set", jobId, stepIndex, path: "if", value });
      } else {
        // Modal-saved value matches the IR original — drop any stale
        // queued patch for this field. Without this, opening the
        // modal on a previously-edited field and saving the original
        // value back leaves the prior patch in the queue
        // (cross-validator audit round 2 finding).
        cancel({ kind: "step.set", jobId, stepIndex, path: "if", value: "" });
      }
    } else {
      setRun(value);
      if (value !== (step.run ?? "")) {
        queue({ kind: "step.set", jobId, stepIndex, path: "run", value });
      } else {
        cancel({ kind: "step.set", jobId, stepIndex, path: "run", value: "" });
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
  // Stable id for the per-step datalist — keyed on jobId+stepIndex so
  // multiple StepForms in the panel (which can't actually coexist, but
  // unit tests render sequentially) get distinct ids.
  const datalistId = `workflow-form-with-keys-${jobId}-${stepIndex}`;
  const knownInputKeys = inputs ? Object.keys(inputs) : [];

  const addSuggestedKey = (key: string): void => {
    setWithRows((rows) =>
      rows.some((r) => r.key === key) ? rows : [...rows, newWithRow(key)],
    );
  };

  const commitField = (path: string, next: string, original: string): void => {
    if (next === original) {
      // Revert to original: drop any queued patch for this target.
      cancel({ kind: "step.set", jobId, stepIndex, path, value: "" });
      return;
    }
    queue({ kind: "step.set", jobId, stepIndex, path, value: next });
  };

  // Every OTHER row — duplicate detection + patch-ownership guards.
  const otherRows = (idx: number): WithRow[] =>
    withRows.filter((_, i) => i !== idx);

  const commitWithRow = (idx: number): void => {
    const row = withRows[idx];
    const plan = planWithRowCommit({ jobId, stepIndex }, row, otherRows(idx), step.with);
    if (plan.kind === "noop") return;
    for (const patch of plan.cancels) cancel(patch);
    if (plan.kind === "duplicate") {
      updateRow(idx, { duplicateKey: true, committedKey: null });
      return;
    }
    for (const patch of plan.queues) queue(patch);
    updateRow(idx, { duplicateKey: false, committedKey: plan.committedKey });
  };

  const updateRow = (idx: number, patch: Partial<WithRow>): void => {
    setWithRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  const removeRow = (idx: number): void => {
    const plan = planWithRowRemoval({ jobId, stepIndex }, withRows[idx], otherRows(idx));
    for (const patch of plan.cancels) cancel(patch);
    for (const patch of plan.queues) queue(patch);
    setWithRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const addRow = (): void => {
    setWithRows((rows) => [...rows, newWithRow()]);
  };

  return (
    <form className="workflow-form" onSubmit={(e) => e.preventDefault()}>
      <header className="workflow-form__header workflow-form__header--step">
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm workflow-form__nav-btn"
          onClick={backToJob}
          aria-label={t("form.step.nav.backToJob", {
            defaultValue: "Back to job",
          })}
          title={t("form.step.nav.backToJob", { defaultValue: "Back to job" })}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm workflow-form__nav-btn"
          onClick={() => goToStep(prevStepId)}
          disabled={!prevStepId}
          aria-label={t("form.step.nav.prev", {
            defaultValue: "Previous step (Alt+Left)",
          })}
          title={t("form.step.nav.prev", {
            defaultValue: "Previous step (Alt+Left)",
          })}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="workflow-form__step-position">
          {t("form.step.nav.position", {
            defaultValue: "Step {{current}} of {{total}}",
            current: stepIndex + 1,
            total: totalSteps,
          })}
        </span>
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm workflow-form__nav-btn"
          onClick={() => goToStep(nextStepId)}
          disabled={!nextStepId}
          aria-label={t("form.step.nav.next", {
            defaultValue: "Next step (Alt+Right)",
          })}
          title={t("form.step.nav.next", {
            defaultValue: "Next step (Alt+Right)",
          })}
        >
          <ChevronRight size={14} />
        </button>
        <code className="workflow-form__id" title={step.id}>
          {step.id}
        </code>
      </header>

      <label className="workflow-form__field">
        <span className="workflow-form__label">{t("form.step.name.label")}</span>
        <input
          className="vm-input vm-input--field workflow-form__input"
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
            className="vm-input vm-input--field vm-input--mono workflow-form__input"
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
          className="vm-input vm-input--field vm-input--mono workflow-form__input"
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
          className="vm-input vm-input--field vm-input--mono workflow-form__input"
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
                      className="vm-input vm-input--field vm-input--mono workflow-form__input"
                      type="text"
                      value={row.key}
                      placeholder={t("form.step.with.keyPlaceholder")}
                      list={knownInputKeys.length > 0 ? datalistId : undefined}
                      aria-describedby={
                        knownInputKeys.length > 0
                          ? `${datalistId}-help`
                          : undefined
                      }
                      aria-invalid={row.duplicateKey || undefined}
                      onChange={(e) => updateRow(idx, { key: e.target.value })}
                      onBlur={() => commitWithRow(idx)}
                    />
                    <input
                      className="vm-input vm-input--field vm-input--mono workflow-form__input"
                      type="text"
                      value={row.value}
                      placeholder={
                        schema?.default ?? t("form.step.with.valuePlaceholder")
                      }
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      onBlur={() => commitWithRow(idx)}
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
                  {row.duplicateKey && (
                    <span className="workflow-form__with-error" role="alert">
                      {t("form.step.with.duplicateKey")}
                    </span>
                  )}
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
            {knownInputKeys.length > 0 && (
              <details
                id={`${datalistId}-help`}
                className="workflow-form__known-inputs"
              >
                <summary className="workflow-form__known-inputs-summary">
                  {t("form.step.with.knownInputs", {
                    defaultValue: "Available inputs ({{count}})",
                    count: knownInputKeys.length,
                  })}
                </summary>
                <div className="workflow-form__known-inputs-list">
                  {Object.entries(inputs!).map(([key, schema]) => {
                    const used = setKeys.has(key);
                    return (
                      <div
                        key={key}
                        className="workflow-form__known-input-row"
                      >
                        <button
                          type="button"
                          className="workflow-form__known-input"
                          data-used={used}
                          disabled={used}
                          onClick={() => addSuggestedKey(key)}
                          aria-label={
                            schema.description
                              ? `${key} — ${schema.description}`
                              : key
                          }
                          title={schema.description ?? ""}
                        >
                          <code>{key}</code>
                          {schema.required && (
                            <span
                              className="workflow-form__known-input-required"
                              aria-label={t("form.step.with.required", {
                                defaultValue: "required",
                              })}
                            >
                              *
                            </span>
                          )}
                        </button>
                        {schema.description && (
                          <span
                            className="workflow-form__known-input-desc"
                            id={`${datalistId}-${key}-desc`}
                          >
                            {schema.description}
                            {schema.default !== undefined && (
                              <em className="workflow-form__known-input-default">
                                {" "}
                                {t("form.step.with.defaultValue", {
                                  defaultValue: "(default: {{value}})",
                                  value: schema.default,
                                })}
                              </em>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            {knownInputKeys.length > 0 && (
              <datalist id={datalistId}>
                {knownInputKeys.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
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
