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
import {
  cronToReadable,
  type CronReadable,
} from "@/lib/ghaWorkflow/cron/readable";

/** Wraps cronToReadable with try/catch — invalid cron returns null. */
function safeCronReadable(cron: string): CronReadable | null {
  try {
    return cronToReadable(cron);
  } catch {
    return null;
  }
}
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
  const cancel = useWorkflowEditStore((s) => s.cancelPatchForTarget);

  const commit = (): void => {
    const next = parseList(value);
    if (arraysEqual(next, current)) {
      // Revert to original: drop any queued setFilters patch for this
      // (event, filter) target.
      cancel({ kind: "trigger.setFilters", event, filter, value: [] });
      return;
    }
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
                    <CronCell cron={tr.cron} />
                  )}
                </div>
              ) : (
                <div className="workflow-form__trigger-meta">
                  {tr.cron && <CronCell cron={tr.cron} />}
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

/**
 * Render a cron expression with the raw value followed by a human-
 * readable summary (e.g., "every 5 minutes", "Mon-Fri at 02:00") and
 * a throttle warning when GHA would silently rate-limit the schedule
 * (interval < 5 min). Invalid cron renders the raw value only.
 */
/**
 * Render the time-part of a cron expression as a localized string.
 * Codex audit MED-5 fix — readable.ts now exposes structured parts
 * so the form can call t() with the appropriate locale string.
 */
function renderCronTime(
  t: ReturnType<typeof useTranslation>["t"],
  readable: CronReadable,
): string {
  const time = readable.time;
  let main: string;
  switch (time.kind) {
    case "every-minute":
      main = t("form.trigger.cron.everyMinute", {
        defaultValue: "every minute",
      });
      break;
    case "every-n-minutes":
      main = t("form.trigger.cron.everyNMinutes", {
        defaultValue: "every {{n}} minutes",
        n: time.n,
      });
      break;
    case "at-time":
      main = t("form.trigger.cron.atTime", {
        defaultValue: "at {{time}}",
        time: time.time,
      });
      break;
    case "at-times":
      main = t("form.trigger.cron.atTimes", {
        defaultValue: "at {{times}}",
        times: time.times.join(", "),
      });
      break;
    case "at-times-many":
      main = t("form.trigger.cron.atTimesMany", {
        defaultValue: "at {{visible}} (+{{rest}} more)",
        visible: time.visible.join(", "),
        rest: time.rest,
      });
      break;
    case "every-minute-of-hour":
      main = t("form.trigger.cron.everyMinuteOfHour", {
        defaultValue: "every minute of hour {{hours}}",
        hours: time.hours,
      });
      break;
    case "every-hour-on-the-hour":
      main = t("form.trigger.cron.everyHourOnTheHour", {
        defaultValue: "every hour on the hour",
      });
      break;
    case "at-minute-of-every-hour":
      main = t("form.trigger.cron.atMinuteOfEveryHour", {
        defaultValue: "at minute {{minutes}} of every hour",
        minutes: time.minutes,
      });
      break;
  }
  const mod = readable.modifiers;
  let suffix = "";
  if (mod.dom) {
    suffix += t("form.trigger.cron.modDom", {
      defaultValue: " on day-of-month {{dom}}",
      dom: mod.dom,
    });
  }
  if (mod.month) {
    suffix += t("form.trigger.cron.modMonth", {
      defaultValue: " in {{month}}",
      month: mod.month,
    });
  }
  if (mod.dowRange) {
    suffix += t("form.trigger.cron.modDowRange", {
      defaultValue: " on {{from}}-{{to}}",
      from: mod.dowRange.from,
      to: mod.dowRange.to,
    });
  } else if (mod.dowList) {
    suffix += t("form.trigger.cron.modDowList", {
      defaultValue: " on {{days}}",
      days: mod.dowList,
    });
  }
  return main + suffix;
}

function CronCell({ cron }: { cron: string }): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const readable = safeCronReadable(cron);
  // Codex audit MED-5 fix: throttle warning previously surfaced via
  // `title=` only — invisible to many screen readers. Now uses
  // role="img" + aria-label so AT users hear the warning.
  const throttleLabel = t("form.trigger.cronThrottled", {
    defaultValue:
      "GitHub silently throttles schedules under 5-minute intervals",
  });
  return (
    <span className="workflow-form__trigger-cron">
      <code
        className="workflow-form__trigger-cron-raw"
        aria-label={t("form.trigger.cronExpression", {
          defaultValue: "Cron expression {{value}}",
          value: cron,
        })}
      >
        {cron}
      </code>
      {readable && (
        <span className="workflow-form__trigger-cron-readable">
          {renderCronTime(t, readable)}
        </span>
      )}
      {readable?.throttled && (
        <span
          className="workflow-form__trigger-cron-throttled"
          role="img"
          aria-label={throttleLabel}
          title={throttleLabel}
        >
          ⚠
        </span>
      )}
    </span>
  );
}
