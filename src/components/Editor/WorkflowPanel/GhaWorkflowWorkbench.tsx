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
 *     class bindToDocument exists to prevent. The same tab is handed to
 *     the forms editor so actionlint lints THIS pane's text (WI-FL3.8).
 *   - The edit store has ONE active binding and stashes each document's
 *     queue on rebind. Two mounted workbenches used to fight over it (the
 *     last mount won), so a workbench rebinds to ITS document whenever a
 *     pointer or focus enters it and again before it saves, and it only
 *     ever applies its own queue (audit 20260907, #293/#296). The mount /
 *     re-parse effect yields while the user's focus is in ANOTHER bound
 *     document's surface: a second pane opening, or this pane re-parsing
 *     after an external change, must not redirect a pane they are typing in.
 *   - Save is `saveGhaWorkflowDocument` (services/workflow), which returns a
 *     typed outcome this component maps to toasts (#294): unchanged output
 *     from applyAndSerialize neither writes nor clears (#297); after the write
 *     only the patches that were written are cleared, and the editor is
 *     overwritten only if the user did not type meanwhile (#298).
 *   - The save lock is keyed by DOCUMENT and lives at module scope (audit R2,
 *     #590). A component ref guarded the BUTTON, so two workbenches bound to
 *     one document — the same file open in two tabs — could each be mid-write,
 *     and the later one would overwrite the earlier one's YAML.
 *   - The forms editor is told WHICH document it belongs to, because the edit
 *     store's active queue may be the other pane's (audit R2, #575).
 *   - The binding follows the document's filePath REACTIVELY (#292): a Save
 *     As of an untitled workflow rebinds without a remount, and CARRIES the
 *     queue — `renameDocument`, not `bindToDocument`, because binding stashes
 *     the old id's patches and restores the new id's, which for a rename
 *     strands the user's edits under a name nothing will ever save. It runs
 *     even when another pane holds the binding: the renamed file's pane need
 *     not be the pane in focus.
 *   - WorkflowEditorPanel is lazy so the yaml mutators + the save pipeline
 *     stay out of the eager App bundle. The chunk loads the first time a
 *     workflow file is on screen in a pane — with or without an edit — so a
 *     viewer pays for it once a workflow is open, not at app start (#300).
 *
 * @coordinates-with src/lib/formats/adapters/yaml.tsx — sole mount (schemaRenderer)
 * @coordinates-with src/components/Editor/WorkflowPanel/WorkflowCanvas.tsx
 * @coordinates-with src/components/Editor/WorkflowEditor/WorkflowEditorPanel.tsx
 * @coordinates-with src/stores/workflowStore.ts — bindToDocument / renameDocument
 * @module components/Editor/WorkflowPanel/GhaWorkflowWorkbench
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
} from "react";
import { useWorkflowStore } from "@/stores/workflowStore";
import { WorkflowCanvas } from "@/components/Editor/WorkflowPanel/WorkflowCanvas";
import { useDocumentStore } from "@/stores/documentStore";
import { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/services/ime/imeToast";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { errorMessage } from "@/utils/errorMessage";
import {
  saveGhaWorkflowDocument,
  workflowDocumentIdFor,
} from "@/services/workflow/saveGhaWorkflowDocument";
import "./gha-workflow-workbench.css";

// Lazy-loaded so the yaml package + mutators + the save pipeline stay out of
// the eager App bundle. The chunk loads whenever a workflow file is on screen
// in a pane (with a tab) — viewing is enough; the canvas itself doesn't need
// them. Suspense fallback is null because the canvas above renders
// synchronously.
const WorkflowEditorPanel = lazy(() =>
  import("@/components/Editor/WorkflowEditor/WorkflowEditorPanel").then(
    (m) => ({ default: m.WorkflowEditorPanel }),
  ),
);

/** The focused element when it is a real one OUTSIDE `root` — the user is working elsewhere. */
function focusedOutside(root: HTMLElement | null): Element | null {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return null;
  return root?.contains(focused) === true ? null : focused;
}

interface GhaWorkflowWorkbenchProps {
  workflow: WorkflowIR;
  /** The hosting pane's tab. Null only in nonconforming harnesses —
   *  SplitPaneEditor always supplies it; without it the forms editor's
   *  binding and save are disabled (canvas stays fully functional). */
  tabId: string | null;
}

/**
 * Documents with a save in flight, keyed by the edit store's document id.
 *
 * Module-level, not a component ref: the lock has to cover the DOCUMENT, and a
 * per-component one only covered the button. Two workbenches bound to the same
 * document (the same file open in two tabs) could each be mid-`saveToPath`,
 * and the later write would overwrite the earlier one's YAML while both
 * commits cleared the same queue (audit R2, #590).
 */
const savingDocuments = new Set<string>();

export function GhaWorkflowWorkbench({
  workflow,
  tabId,
}: GhaWorkflowWorkbenchProps): ReactElement {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  // The document id this pane last bound under, so a CHANGE of it is
  // distinguishable from a re-parse. Not derivable from the store: another
  // pane may hold the binding when this pane's file is renamed (#292).
  const ownDocumentId = useRef<string | null>(null);
  // The edit store's id for THIS pane's document — the queue the forms editor
  // must preview and the save must write. Not read from the store's active
  // binding, which may belong to the other pane (#293).
  //
  // Computed by `workflowDocumentIdFor`, the SAME function the save path uses
  // (audit R3 #591). The formula was written out again here — `filePath ??
  // untitled:<tab>` — so a workbench could come to preview one queue and save
  // another, which is precisely the cross-document corruption the binding
  // exists to prevent. It is read through a store SELECTOR rather than a bare
  // call so a Save As (a path change with no remount) re-renders this pane and
  // the id follows it (#292); the selector returns a string, so an unrelated
  // document-store write does not re-render.
  const documentId = useDocumentStore(() => (tabId ? workflowDocumentIdFor(tabId) : null));

  // Bind the edit store's patch queue to this document on mount and when
  // the document changes; a change of binding also resets the canvas
  // selection, which belongs to the previous document. NOT while another
  // document is bound and the user's keyboard focus is outside this
  // workbench: they are mid-edit in the other pane, and a mount or a
  // re-parse here must not redirect their next patch — the pointer/focus
  // capture below binds this one when they come here (#293, round 2).
  useEffect(() => {
    if (!tabId || documentId === null) return;
    const docId = documentId;
    // Read BEFORE the rename below, which can move the binding itself: the
    // canvas selection belongs to the document that was bound on entry.
    const previousId = useWorkflowStore.getState().edit.boundDocumentId;

    // A Save As renamed THIS pane's document: its queued patches move with it,
    // whether or not this pane currently holds the binding. Before the early
    // return below, because the pane the user is typing in may be the other
    // one — and edits stranded under `untitled:<tab>` are never saved (#292).
    const previousOwnId = ownDocumentId.current;
    ownDocumentId.current = docId;
    if (previousOwnId !== null && previousOwnId !== docId) {
      useWorkflowStore.getState().renameDocument(previousOwnId, docId);
    }

    if (previousId !== null && previousId !== docId && focusedOutside(rootRef.current) !== null) return;
    useWorkflowStore.getState().bindToDocument(docId);
    if (previousId !== docId) {
      useWorkflowStore.getState().resetView();
    }
  }, [workflow, tabId, documentId]);

  // A pointer or focus entering this workbench makes it the active one:
  // the forms' next patch must land in THIS document's queue. Idempotent
  // when already bound; the selection is left alone (the user may be
  // clicking into the very form the selection opened).
  const rebind = useCallback((): void => {
    if (!tabId) return;
    // `pointerdown` fires BEFORE the browser moves focus, so a field in the
    // OTHER pane has not blurred yet — and blur is how the forms COMMIT. Blur
    // it first, under the binding it still belongs to, or its patch is queued
    // against this pane's document (audit 20260907, #293, round 3).
    const outgoing = focusedOutside(rootRef.current);
    if (outgoing instanceof HTMLElement) outgoing.blur();
    useWorkflowStore.getState().bindToDocument(workflowDocumentIdFor(tabId));
  }, [tabId]);

  const handleSave = useCallback(async (): Promise<void> => {
    // The lock is taken on the DOCUMENT the save will write, read fresh rather
    // than from `documentId`: a Save As may have landed since this callback
    // was built (#590).
    const savingId = tabId ? workflowDocumentIdFor(tabId) : null;
    if (!tabId || savingId === null || savingDocuments.has(savingId)) return;
    savingDocuments.add(savingId);
    try {
      const outcome = await saveGhaWorkflowDocument(tabId);
      if (outcome === "nothing-applied") {
        toast.warning(t("workflowEditor:save.nothingAppliedToast"));
      } else if (outcome === "saved") {
        toast.success(t("workflowEditor:save.savedToast"));
      } else if (outcome === "updated-in-editor") {
        toast.success(t("workflowEditor:save.updatedNoPathToast"));
      }
      // "write-failed" was surfaced by saveToPath itself; the rest is silence.
    } catch (error) {
      toast.error(
        `${t("workflowEditor:save.errorTitle")}: ${errorMessage(error)}`,
      );
    } finally {
      savingDocuments.delete(savingId);
    }
  }, [tabId, t]);

  return (
    <div
      ref={rootRef}
      className="gha-workflow-workbench"
      aria-label={t("workflowEditor:panel.title")}
      onPointerDownCapture={rebind}
      onFocusCapture={rebind}
    >
      <div className="gha-workflow-workbench__canvas">
        <WorkflowCanvas workflow={workflow} />
      </div>
      {tabId && (
        <Suspense fallback={null}>
          <WorkflowEditorPanel
            workflow={workflow}
            tabId={tabId}
            documentId={documentId}
            onSave={handleSave}
          />
        </Suspense>
      )}
    </div>
  );
}
