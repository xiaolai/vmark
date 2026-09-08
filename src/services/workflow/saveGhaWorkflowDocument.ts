/**
 * saveGhaWorkflowDocument — the GHA workbench's save pipeline as a service.
 *
 * Purpose: bind the edit store to the tab's document, apply its pending
 * patches to the document text, write the result to disk when the document
 * has a path, then reflect the write in the editor and clear exactly the
 * patches that were written. The workbench used to own all of this inside its
 * click handler, next to the toasts (audit 20260907, #294); it now maps the
 * typed outcome returned here to its notifications and nothing else.
 *
 * Key decisions:
 *   - Disk write FIRST (`saveToPath`): if it fails the queue stays intact for a
 *     retry — clearing it and mutating the document pre-write loses the user's
 *     work on a disk-full / permission-denied / parent-missing failure.
 *   - Serialization is non-throwing and now DISCRIMINATED (#991/#1006):
 *     `serializeWorkflowEdits` says whether the document failed to parse, a
 *     patch would not apply, the binding had moved to another pane, or the
 *     edits genuinely changed nothing. All four still surface as
 *     `nothing-applied` — one user-facing message covers them, and the
 *     workbench's toast already says "did not change the YAML, or it could not
 *     be parsed" — but the reason is now LOGGED instead of being unknowable.
 *     Nothing is written or cleared in any of them (#297).
 *   - The store has ONE active binding; the pipeline rebinds to THIS tab's
 *     document before reading the queue and again before committing, so a
 *     workbench in the other pane that took the binding meanwhile is never
 *     saved through (#296).
 *   - After the write, the editor is overwritten only if the user did not type
 *     meanwhile, and only the patches that were written are cleared (#298).
 *   - `saveToPath` is imported lazily so it stays out of the eager App bundle.
 *
 * @coordinates-with src/components/Editor/WorkflowPanel/GhaWorkflowWorkbench.tsx — the caller
 * @coordinates-with src/stores/workflowStore.ts — the edit slice (binding, queue, serializeWorkflowEdits)
 * @coordinates-with src/services/persistence/saveToPath.ts — the disk write
 * @module services/workflow/saveGhaWorkflowDocument
 */
import { useWorkflowStore, type WorkflowEditsResult } from "@/stores/workflowStore";
import { useDocumentStore } from "@/stores/documentStore";
import { workflowWarn } from "@/utils/debug";
import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";

export type SaveGhaWorkflowOutcome =
  /** The tab has no document. */
  | "missing-document"
  /** Nothing queued for this document. */
  | "nothing-pending"
  /** The queue changed nothing — a parse failure, a patch that would not
   *  apply, a stale binding, or a genuine no-op. Which one is in the log
   *  (#991); the user-facing message is deliberately one for all four. */
  | "nothing-applied"
  /** `saveToPath` reported failure (and has surfaced it); queue and document untouched. */
  | "write-failed"
  /** Written to disk, reflected in the editor, written patches cleared. */
  | "saved"
  /** Untitled: reflected in the editor only (Cmd+Shift+S saves), patches cleared. */
  | "updated-in-editor";

/** The edit store's id for a tab's document: its real filePath, or an
 *  untitled id. A content-derived id collided on common shapes like
 *  "(unnamed)::build" and corrupted patches across documents (Codex round 5)
 *  — the binding must follow the file. */
export function workflowDocumentIdFor(tabId: string): string {
  const doc = useDocumentStore.getState().documents[tabId];
  return doc?.filePath ?? `untitled:${tabId}`;
}

/**
 * After a successful write: reflect `next` in the editor unless the user typed
 * meanwhile (the disk has `next`; their newer text must not be replaced by
 * it), and clear only the patches that were written — anything queued during
 * the write stays. Rebinds first, since another workbench may have taken the
 * binding while the write was in flight.
 *
 * It rebinds to `documentId` — the id whose queue was WRITTEN — not to whatever
 * the tab resolves to now (audit #988). `workflowDocumentIdFor` is derived from
 * the live document, so a tab closed or renamed during the write returned a
 * DIFFERENT id: the store was bound to a phantom (`untitled:<closed tab>`) or to
 * another document, and the `clearPatches` that followed emptied a queue that
 * had nothing to do with this save.
 */
function commit(
  tabId: string,
  documentId: string,
  before: string,
  next: string,
  written: readonly IRPatch[],
): void {
  const docState = useDocumentStore.getState();
  if (docState.documents[tabId]?.content === before) docState.setEditorContent(tabId, next);
  const store = useWorkflowStore.getState();
  store.bindToDocument(documentId);
  const remaining = useWorkflowStore.getState().edit.pendingPatches.filter((p) => !written.includes(p));
  store.clearPatches();
  for (const patch of remaining) useWorkflowStore.getState().queuePatch(patch);
}

/** Saves in flight, keyed by tab — one at a time per document (audit #990). */
const inFlight = new Map<string, Promise<SaveGhaWorkflowOutcome>>();

/**
 * Save the pending patches of `tabId`'s workflow document; see the header.
 *
 * SINGLE-FLIGHT per tab (audit #990). Two overlapping saves each captured their
 * own patch snapshot; the first commit changed the document's content, so the
 * second's `content === before` check failed and it skipped the editor update —
 * while still clearing patches that existed only in ITS serialized result. A
 * second call joins the first rather than racing it.
 */
export function saveGhaWorkflowDocument(tabId: string): Promise<SaveGhaWorkflowOutcome> {
  const running = inFlight.get(tabId);
  if (running) return running;
  const run = runSave(tabId).finally(() => {
    if (inFlight.get(tabId) === run) inFlight.delete(tabId);
  });
  inFlight.set(tabId, run);
  return run;
}

async function runSave(tabId: string): Promise<SaveGhaWorkflowOutcome> {
  // The lazy import comes FIRST (audit #992). It is the only await between
  // reading the document and handing it to `saveToPath`, and `saveToPath`
  // orders competing writes by a per-DOCUMENT save-target claim taken when it
  // is called — so waiting for a module here let a Save As issued afterwards
  // claim first, which then read this older operation as the newer one and
  // restored the previous path. Everything after this line is synchronous up to
  // the write, so there is no window left.
  const { saveToPath } = await import("@/services/persistence/saveToPath");
  const tabDoc = useDocumentStore.getState().documents[tabId];
  if (!tabDoc) return "missing-document";
  const documentId = workflowDocumentIdFor(tabId);
  const editStore = useWorkflowStore.getState();
  editStore.bindToDocument(documentId);
  const written = useWorkflowStore.getState().edit.pendingPatches;
  if (written.length === 0) return "nothing-pending";
  // The document id is asserted, not assumed: the store has ONE binding slot,
  // and serializing another pane's queue is the defect the assertion names.
  const result = editStore.serializeWorkflowEdits(tabDoc.content, documentId);
  if (result.status !== "applied") {
    // WHICH failure, in the log the user can send with a bug report (#991).
    // String equality against the input could not tell a document that will
    // never parse from an edit that legitimately changes nothing, so a queue
    // that could never be saved looked exactly like one with nothing to do.
    workflowWarn(
      `Workflow save applied nothing for ${documentId}: ${describeSerializeFailure(result)}`,
    );
    return "nothing-applied";
  }
  const next = result.yaml;
  if (tabDoc.filePath) {
    if (!(await saveToPath(tabId, tabDoc.filePath, next, "manual"))) return "write-failed";
    commit(tabId, documentId, tabDoc.content, next, written);
    return "saved";
  }
  commit(tabId, documentId, tabDoc.content, next, written);
  return "updated-in-editor";
}

/** One log-line reason for a serialization that produced nothing (#991). */
function describeSerializeFailure(
  result: Exclude<WorkflowEditsResult, { status: "applied" }>,
): string {
  switch (result.status) {
    case "parse-failed":
      return `the document does not parse (${result.detail})`;
    case "apply-failed":
      return `a patch could not be applied (${result.detail})`;
    case "wrong-document":
      return `the queue is bound to ${String(result.boundDocumentId)}`;
    case "unchanged":
      return "the queued edits change nothing";
    case "no-patches":
      return "the queue is empty";
  }
}
