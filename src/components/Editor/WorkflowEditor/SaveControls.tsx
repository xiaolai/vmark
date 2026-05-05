/**
 * Purpose: Save/Discard control bar for the workflow editor panel.
 *   Surfaces dirty state from `workflowEditStore` and routes user
 *   action through the parent-supplied async `onSave` handler (which
 *   does the disk write) and `onDiscard` handler (which reloads
 *   from source).
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 7 / WI-7.2.
 *
 * Key decisions:
 *   - Both onSave and onDiscard are caller-owned. The control bar is
 *     a thin presentation surface — disk I/O and source reset live
 *     in the consumer (WorkflowEditorPanel).
 *   - Clear-on-discard is built in: clicking Discard clears the patch
 *     queue before calling the caller's onDiscard so the caller never
 *     has to think about it.
 *
 * @coordinates-with src/stores/workflowEditStore.ts — pendingPatches
 * @module components/Editor/WorkflowEditor/SaveControls
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  selectWorkflowEditDirty,
  useWorkflowEditStore,
} from "@/stores/workflowEditStore";
import "./workflow-editor.css";

interface SaveControlsProps {
  onSave: () => Promise<void> | void;
  onDiscard: () => void;
}

export function SaveControls({
  onSave,
  onDiscard,
}: SaveControlsProps): ReactElement {
  const { t } = useTranslation("workflowEditor");

  const patches = useWorkflowEditStore((s) => s.pendingPatches);
  const clear = useWorkflowEditStore((s) => s.clearPatches);
  const dirty = selectWorkflowEditDirty({
    pendingPatches: patches,
    preserveYamlFormatting: true,
    boundDocumentId: null,
    patchesByDocument: {},
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = (): void => {
    if (!dirty) return;
    clear();
    onDiscard();
  };

  return (
    <div className="workflow-editor-panel__controls">
      <span
        className="workflow-editor-panel__controls-status"
        data-dirty={dirty}
      >
        {dirty
          ? t("save.dirtyHint", { count: patches.length })
          : t("save.cleanHint")}
      </span>
      <div className="workflow-editor-panel__controls-buttons">
        <button
          type="button"
          className="workflow-editor-panel__btn"
          onClick={handleDiscard}
          disabled={!dirty}
        >
          {t("save.discardButton")}
        </button>
        <button
          type="button"
          className="workflow-editor-panel__btn workflow-editor-panel__btn--primary"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {t("save.button")}
        </button>
      </div>
    </div>
  );
}
