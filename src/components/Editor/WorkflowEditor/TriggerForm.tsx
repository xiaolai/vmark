/**
 * Purpose: Renders a workflow's `on:` triggers. Triggers whose YAML
 *   shape is already a mapping (i.e. the trigger has at least one
 *   filter populated) get inline-editable comma-separated lists for
 *   branches / branches-ignore / tags / tags-ignore / paths /
 *   paths-ignore / types. Everything else (cron, scalar/array form
 *   triggers, inputs, secrets) stays read-only — reshaping `on:` is
 *   easy to get wrong via single-line inputs and is better expressed
 *   in source.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 7 / WI-7.1 + Phase 9 finish.
 *
 * Edit mechanics: each editable list is a comma-separated input with
 * a blur-to-commit handler. Empty input = clear the filter.
 *
 * @coordinates-with src/stores/workflowEditStore.ts — IRPatch sink
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — TriggerSetFiltersPatch
 * @module components/Editor/WorkflowEditor/TriggerForm
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TriggerIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import type { TriggerFilter } from "@/lib/ghaWorkflow/save/mutators";
import "./workflow-editor.css";

interface TriggerFormProps {
  triggers: TriggerIR[];
}

/** True when the trigger already has at least one filter populated —
 * which means the YAML side is already a mapping form, the only shape
 * the trigger.setFilters mutator can edit safely. */
function isEditableTrigger(tr: TriggerIR): boolean {
  return Boolean(
    (tr.branches && tr.branches.length > 0) ||
      (tr.branchesIgnore && tr.branchesIgnore.length > 0) ||
      (tr.tags && tr.tags.length > 0) ||
      (tr.tagsIgnore && tr.tagsIgnore.length > 0) ||
      (tr.paths && tr.paths.length > 0) ||
      (tr.pathsIgnore && tr.pathsIgnore.length > 0) ||
      (tr.types && tr.types.length > 0),
  );
}

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

interface FilterFieldProps {
  event: string;
  filter: TriggerFilter;
  /** IR-side property name for reading the current value (kebab → camel). */
  current: readonly string[];
  label: string;
}

function FilterField({
  event,
  filter,
  current,
  label,
}: FilterFieldProps): ReactElement {
  const [value, setValue] = useState(current.join(", "));
  const queue = useWorkflowEditStore((s) => s.queuePatch);

  const commit = (): void => {
    const next = parseList(value);
    if (arraysEqual(next, current)) return;
    queue({
      kind: "trigger.setFilters",
      event,
      filter,
      value: next,
    });
  };

  return (
    <label className="workflow-form__field workflow-form__field--inline">
      <span className="workflow-form__label">{label}</span>
      <input
        className="workflow-form__input workflow-form__input--mono"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
      />
    </label>
  );
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
        {triggers.map((tr, idx) => {
          const editable = isEditableTrigger(tr);
          return (
            <li key={idx} className="workflow-form__trigger-item">
              <span className="workflow-form__trigger-event">{tr.event}</span>
              {editable ? (
                <div className="workflow-form__trigger-fields">
                  {tr.branches !== undefined && (
                    <FilterField
                      event={tr.event}
                      filter="branches"
                      current={tr.branches}
                      label={t("form.trigger.branchesEdit")}
                    />
                  )}
                  {tr.branchesIgnore !== undefined && (
                    <FilterField
                      event={tr.event}
                      filter="branches-ignore"
                      current={tr.branchesIgnore}
                      label={t("form.trigger.branchesIgnoreEdit")}
                    />
                  )}
                  {tr.tags !== undefined && (
                    <FilterField
                      event={tr.event}
                      filter="tags"
                      current={tr.tags}
                      label={t("form.trigger.tagsEdit")}
                    />
                  )}
                  {tr.tagsIgnore !== undefined && (
                    <FilterField
                      event={tr.event}
                      filter="tags-ignore"
                      current={tr.tagsIgnore}
                      label={t("form.trigger.tagsIgnoreEdit")}
                    />
                  )}
                  {tr.paths !== undefined && (
                    <FilterField
                      event={tr.event}
                      filter="paths"
                      current={tr.paths}
                      label={t("form.trigger.pathsEdit")}
                    />
                  )}
                  {tr.pathsIgnore !== undefined && (
                    <FilterField
                      event={tr.event}
                      filter="paths-ignore"
                      current={tr.pathsIgnore}
                      label={t("form.trigger.pathsIgnoreEdit")}
                    />
                  )}
                  {tr.types !== undefined && (
                    <FilterField
                      event={tr.event}
                      filter="types"
                      current={tr.types}
                      label={t("form.trigger.typesEdit")}
                    />
                  )}
                  {tr.cron && (
                    <span className="workflow-form__trigger-meta">
                      {t("form.trigger.cron", { value: tr.cron })}
                    </span>
                  )}
                </div>
              ) : (
                <div className="workflow-form__trigger-meta">
                  {tr.cron && (
                    <span>{t("form.trigger.cron", { value: tr.cron })}</span>
                  )}
                  {!tr.cron && (
                    <span className="workflow-form__trigger-readonly-hint">
                      {t("form.trigger.readonlyHint")}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
