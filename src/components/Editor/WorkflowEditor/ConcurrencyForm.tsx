/**
 * Purpose: WI-C.3 — workflow-level concurrency editor.
 *
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — workflow.concurrency.set patch
 * @module components/Editor/WorkflowEditor/ConcurrencyForm
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { ConcurrencyIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import "./workflow-editor.css";

interface ConcurrencyFormProps {
  concurrency: ConcurrencyIR | undefined;
}

export function ConcurrencyForm({
  concurrency,
}: ConcurrencyFormProps): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const queue = useWorkflowEditStore((s) => s.queuePatch);
  const [group, setGroup] = useState(concurrency?.group ?? "");
  // ConcurrencyIR.cancelInProgress can be boolean OR an expression
  // string. The form models the literal boolean only — expression-based
  // values stay editable in source.
  const [cancelInProgress, setCancelInProgress] = useState<boolean>(
    concurrency?.cancelInProgress === true,
  );

  const commit = (nextGroup: string, nextCancel: boolean): void => {
    if (!nextGroup) {
      queue({ kind: "workflow.concurrency.set", value: null });
      return;
    }
    if (nextCancel) {
      queue({
        kind: "workflow.concurrency.set",
        value: { group: nextGroup, cancelInProgress: true },
      });
    } else {
      queue({ kind: "workflow.concurrency.set", value: nextGroup });
    }
  };

  return (
    <section className="workflow-form workflow-form--inline">
      <header className="workflow-form__inline-header">
        <span className="workflow-form__label">
          {t("form.concurrency.label", { defaultValue: "Concurrency" })}
        </span>
      </header>
      <label className="workflow-form__field">
        <span className="workflow-form__label">
          {t("form.concurrency.group", { defaultValue: "Group" })}
        </span>
        <input
          className="workflow-form__input workflow-form__input--mono"
          type="text"
          value={group}
          placeholder="ci-${{ github.ref }}"
          onChange={(e) => setGroup(e.target.value)}
          onBlur={() => commit(group, cancelInProgress)}
        />
      </label>
      <label className="workflow-form__field workflow-form__field--inline">
        <input
          type="checkbox"
          checked={cancelInProgress}
          disabled={!group}
          onChange={(e) => {
            const next = e.target.checked;
            setCancelInProgress(next);
            commit(group, next);
          }}
        />
        <span>
          {t("form.concurrency.cancelInProgress", {
            defaultValue: "Cancel in progress",
          })}
        </span>
      </label>
    </section>
  );
}
