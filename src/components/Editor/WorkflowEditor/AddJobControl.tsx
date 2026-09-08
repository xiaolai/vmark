/**
 * The forms editor's inline "Add job" prompt, split out of
 * WorkflowEditorPanel (which was one line under the file-size limit) when its
 * validation grew a voice (audit R2, #581).
 *
 * Key decisions:
 *   - ONE definition of what a usable job id is. The rule used to be written
 *     twice — in `submit` and in the Add button's `disabled` expression — so
 *     the two could drift, and neither could be tested without rendering.
 *     `jobIdProblem` is that rule, and it also names WHICH rule was broken.
 *   - A rejection is SAID, not merely enforced. Enter on a duplicate or a
 *     malformed id used to do nothing at all, next to an Add button that was
 *     disabled for no stated reason. The message is `role="alert"` and is the
 *     field's `aria-describedby`, with `aria-invalid` on the field, so it
 *     reaches a screen reader as well as the eye.
 *   - The field has a real accessible NAME. A placeholder is not a label: it
 *     is announced inconsistently and disappears the moment the user types.
 *   - An empty draft is not an error. Nothing is wrong until something has
 *     been typed, so the prompt opens silent and the button is simply
 *     disabled.
 *
 * @coordinates-with ./WorkflowEditorPanel.tsx — the only consumer
 * @coordinates-with src/stores/workflowStore.ts — queuePatch("job.create")
 * @module components/Editor/WorkflowEditor/AddJobControl
 */
import { useId, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useWorkflowStore } from "@/stores/workflowStore";

/** What GitHub Actions accepts as a job id. */
const JOB_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Why this draft cannot become a job id — or null when it can (or is empty). */
export type JobIdProblem = "duplicate" | "invalid";

export function jobIdProblem(
  draft: string,
  existingIds: readonly string[],
): JobIdProblem | null {
  const id = draft.trim();
  if (id === "") return null;
  if (existingIds.includes(id)) return "duplicate";
  return JOB_ID_PATTERN.test(id) ? null : "invalid";
}

export interface AddJobControlProps {
  existingIds: readonly string[];
}

/** Inline "Add job" affordance — toggles a tiny prompt on click. */
export function AddJobControl({ existingIds }: AddJobControlProps): ReactElement {
  const { t } = useTranslation(["workflowEditor", "common"]);
  const [open, setOpen] = useState(false);
  const [draftId, setDraftId] = useState("");
  const queue = useWorkflowStore((s) => s.queuePatch);
  const messageId = useId();

  const problem = jobIdProblem(draftId, existingIds);
  const usable = draftId.trim() !== "" && problem === null;

  const close = () => {
    setOpen(false);
    setDraftId("");
  };

  const submit = () => {
    if (!usable) return;
    queue({ kind: "job.create", jobId: draftId.trim() });
    close();
  };

  return (
    <div className="workflow-editor-panel__add-job">
      {!open && (
        <button
          type="button"
          className="workflow-editor-panel__add-job-toggle"
          onClick={() => setOpen(true)}
        >
          {`+ ${t("form.job.add.toggle")}`}
        </button>
      )}
      {open && (
        <div className="workflow-editor-panel__add-job-form">
          <input
            className="vm-input vm-input--field vm-input--mono workflow-form__input"
            type="text"
            value={draftId}
            placeholder={t("form.job.add.idPlaceholder")}
            aria-label={t("form.job.add.idLabel")}
            aria-invalid={problem !== null}
            aria-describedby={problem === null ? undefined : messageId}
            autoFocus
            onChange={(e) => setDraftId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          <button
            type="button"
            className="workflow-editor-panel__add-job-submit"
            onClick={submit}
            disabled={!usable}
          >
            {t("form.job.add.submit")}
          </button>
          <button
            type="button"
            className="workflow-editor-panel__add-job-cancel"
            onClick={close}
          >
            {t("common:cancel")}
          </button>
          {problem !== null && (
            <p className="workflow-editor-panel__add-job-error" id={messageId} role="alert">
              {problem === "duplicate"
                ? t("form.job.add.duplicate")
                : t("form.job.add.invalid")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
