/**
 * Purpose: The GHA workflow workbench — interactive canvas + structured
 *   forms editor + save pipeline for standalone workflow files. Mounted
 *   by the yaml adapter's `gha-workflow` schemaRenderer inside the
 *   split-pane preview, so it fills whatever pane the split view gives
 *   it (no panel chrome, no resize handle — the split pane owns those).
 *
 *   Successor to GhaWorkflowSidePanel: when standalone YAML routing
 *   moved from the markdown editor to the split pane (WI-2.4), the side
 *   panel's mount became unreachable and the forms editor silently
 *   dropped out of the product. This component restores it in the
 *   surface where workflow files actually open.
 *
 * Key decisions:
 *   - The workflow IR arrives via props from the schemaRenderer's own
 *     parse — this component does not read the workflowStore `gha`
 *     slice, so it works in preview-only view mode where the source
 *     pane (the slice's writer) is unmounted.
 *   - The hosting tab arrives via props too (from SplitPaneEditor).
 *     Reading tabStore's focused-pane `activeTabId` here would bind the
 *     patch queue and save target to the OTHER pane's document under
 *     document split (#1081) — the cross-document patch-corruption
 *     class bindToDocument exists to prevent.
 *   - WorkflowEditorPanel stays lazy so yaml mutators + the save
 *     pipeline don't land in the eager App bundle; viewers who never
 *     edit never load them.
 *
 * @coordinates-with src/lib/formats/adapters/yaml.tsx — sole mount (schemaRenderer)
 * @coordinates-with src/components/Editor/WorkflowPanel/WorkflowCanvas.tsx
 * @coordinates-with src/components/Editor/WorkflowEditor/WorkflowEditorPanel.tsx
 * @module plugins/ghaWorkflowPreview/GhaWorkflowWorkbench
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  type ReactElement,
} from "react";
import { useWorkflowStore } from "@/stores/workflowStore";
import { WorkflowCanvas } from "@/components/Editor/WorkflowPanel/WorkflowCanvas";
import { useDocumentStore } from "@/stores/documentStore";
import { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/services/ime/imeToast";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { errorMessage } from "@/utils/errorMessage";
import "./gha-workflow-workbench.css";

// Lazy-loaded so the yaml package + mutators + the save pipeline only
// load once a workflow file is being viewed; the canvas itself doesn't
// need them. Suspense fallback is null because the canvas above renders
// synchronously.
const WorkflowEditorPanel = lazy(() =>
  import("@/components/Editor/WorkflowEditor/WorkflowEditorPanel").then(
    (m) => ({ default: m.WorkflowEditorPanel }),
  ),
);

interface GhaWorkflowWorkbenchProps {
  workflow: WorkflowIR;
  /** The hosting pane's tab. Null only in nonconforming harnesses —
   *  SplitPaneEditor always supplies it; without it the forms editor's
   *  binding and save are disabled (canvas stays fully functional). */
  tabId: string | null;
}

export function GhaWorkflowWorkbench({
  workflow,
  tabId,
}: GhaWorkflowWorkbenchProps): ReactElement {
  const { t } = useTranslation();

  // Bind the edit store's patch queue to this document's real filePath
  // (or untitled tab id). A content-derived id collided on common
  // shapes like "(unnamed)::build" and corrupted patches across
  // documents (Codex round 5) — the binding must follow the file.
  useEffect(() => {
    if (!tabId) return;
    const doc = useDocumentStore.getState().documents[tabId];
    const docId = doc?.filePath ?? `untitled:${tabId}`;
    const store = useWorkflowStore.getState();
    const previousId = store.edit.boundDocumentId;
    store.bindToDocument(docId);
    if (previousId !== docId) {
      useWorkflowStore.getState().resetView();
    }
  }, [workflow, tabId]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!tabId) return;
    const docState = useDocumentStore.getState();
    const tabDoc = docState.documents[tabId];
    if (!tabDoc) return;
    // Lazy-imports keep the yaml package + mutators + saveToPath out of
    // the eager App bundle. Forms-editor users pay the cost; viewers
    // never load these modules.
    const { saveToPath } = await import("@/services/persistence/saveToPath");
    const editStore = useWorkflowStore.getState();
    if (editStore.edit.pendingPatches.length === 0) return;
    try {
      const next = editStore.applyAndSerialize(tabDoc.content);
      if (tabDoc.filePath) {
        // Disk write FIRST. If saveToPath fails, the patch queue stays
        // intact so the user can retry — clearing the queue and
        // mutating the doc state pre-write loses the user's work on a
        // disk-full / permission-denied / parent-missing failure
        // (auditor finding: data-loss risk).
        const ok = await saveToPath(tabId, tabDoc.filePath, next, "manual");
        if (!ok) return;
        docState.setEditorContent(tabId, next);
        editStore.clearPatches();
        toast.success(t("workflowEditor:save.savedToast"));
      } else {
        // Untitled workflows have no path. Reflect the change in the
        // editor so the user can Cmd+Shift+S to save; the queue clears
        // because the IR-side change is already applied to the doc.
        docState.setEditorContent(tabId, next);
        editStore.clearPatches();
        toast.success(t("workflowEditor:save.updatedNoPathToast"));
      }
    } catch (error) {
      toast.error(
        `${t("workflowEditor:save.errorTitle")}: ${errorMessage(error)}`,
      );
    }
  }, [tabId, t]);

  const handleDiscard = useCallback((): void => {
    // Patch queue is cleared inside SaveControls before this fires;
    // there's no source-of-truth reload to do because the editor's
    // YAML content is unchanged (forms only buffer patches). Once
    // clearPatches() runs, the next render rebuilds form state from
    // the IR — which is regenerated from the unchanged source.
  }, []);

  return (
    <div
      className="gha-workflow-workbench"
      aria-label={t("workflowEditor:panel.title")}
    >
      <div className="gha-workflow-workbench__canvas">
        <WorkflowCanvas workflow={workflow} />
      </div>
      {tabId && (
        <Suspense fallback={null}>
          <WorkflowEditorPanel
            workflow={workflow}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        </Suspense>
      )}
    </div>
  );
}
