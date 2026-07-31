/**
 * Tab Operations (Hooks Layer)
 *
 * Purpose: Async tab lifecycle functions with side effects — close with
 *   dirty check and close-time orphan cleanup.
 *
 * Key decisions:
 *   - Lives in hooks/ (not utils/) because it has Tauri dialog + store side effects
 *   - Dirty AND divergent documents need resolution before closing (WI-2). A
 *     divergent doc — the user kept local content after an external edit — has
 *     isDirty false, but closing it silently would discard exactly the content
 *     the user already chose once to keep.
 *   - Document state is REVALIDATED after every await (WI-5). Prompts, saves
 *     and cleanup all yield; an edit (human or MCP — VMark exposes writes over
 *     MCP) landing mid-await must trigger another prompt, not be dropped. The
 *     loop is bounded: a document that cannot be brought to rest is a cancel,
 *     never a silent discard. One exemption: a buffer byte-identical to a
 *     completed save is AT REST even with isDirty standing — save-time
 *     normalization (hard-break style) is an artifact, not an edit.
 *   - Concurrent closes of one tab share ONE promise and ONE outcome (WI-7).
 *     The old boolean guard answered `true` to the second caller while the
 *     first might still be cancelled.
 *   - A document tab whose document state is missing is CLOSED, not reported
 *     closed (WI-6) — the old `return true` left the tab on screen forever and
 *     defeated useFileOpen's close-during-open guard.
 *   - closeTab's return value gates cleanupTabState (WI-5): a pinned refusal
 *     must not wipe the document of a tab still visible.
 *   - Pinned tabs are short-circuited with the unpin-before-closing toast, and
 *     pin state is re-checked after the prompts — pinning DURING the dialog is
 *     a "keep this" signal too.
 *   - Browser tabs close without a document — a web page has nothing to save.
 *
 * @coordinates-with closeSave.ts — promptSaveForDirtyDocument dialog
 * @coordinates-with services/media/closeCleanup.ts — close-time orphan cleanup
 * @coordinates-with tabStore.ts — closeTab reports whether removal happened
 * @coordinates-with tabCleanup.ts — cleanupTabState centralises per-tab store cleanup
 * @module hooks/useTabOperations
 */

import { promptSaveForDirtyDocument } from "@/hooks/closeSave";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { cleanupOrphansForClosingTabs } from "@/services/media/closeCleanup";
import { cleanupTabState } from "@/hooks/tabCleanup";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import type { DocumentState } from "@/stores/documentStore";

/** A document needs resolving before close when it is dirty OR divergent (WI-2). */
function needsResolution(doc: Pick<DocumentState, "isDirty" | "isDivergent">): boolean {
  return doc.isDirty || doc.isDivergent;
}

/**
 * Bound on prompt→revalidate iterations. Each pass means "the document changed
 * while we were saving or asking" — twice is a race, three times is a hostile
 * concurrent writer, and at that point refusing to close loses nothing.
 */
const MAX_RESOLUTION_ATTEMPTS = 3;

type Resolution =
  /** `settledContent` set: saved at that content, residual isDirty is a
   *  save-normalization artifact — at rest AS LONG AS the content matches. */
  | { kind: "clean"; settledContent?: string }
  | { kind: "discarded" }
  | { kind: "cancelled" };

/** At rest: genuinely clean, or dirty only by the save-normalization artifact. */
function atRest(
  doc: Pick<DocumentState, "isDirty" | "isDivergent" | "content">,
  resolution: Resolution
): boolean {
  if (!needsResolution(doc)) return true;
  return resolution.kind === "clean" && doc.content === resolution.settledContent;
}

/**
 * Bring one document to rest: prompt while it needs resolution, re-checking
 * after every save because an edit that lands DURING the save leaves it dirty
 * again (WI-5). "discarded" is the user's explicit choice to drop whatever the
 * buffer holds at close time — later edits included.
 */
async function resolveDirtyState(
  windowLabel: string,
  tabId: string,
  fallbackTitle: string
): Promise<Resolution> {
  for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
    // WI-10: an edit still in the editor's debounce window must count.
    flushAllWysiwygNow();
    const doc = useDocumentStore.getState().getDocument(tabId);
    if (!doc || !needsResolution(doc)) return { kind: "clean" };

    const contentAtPrompt = doc.content;
    const result = await promptSaveForDirtyDocument({
      windowLabel,
      tabId,
      title: doc.filePath || fallbackTitle,
      filePath: doc.filePath,
      content: contentAtPrompt,
      divergent: !doc.isDirty && doc.isDivergent,
    });
    if (result.action === "cancelled") return { kind: "cancelled" };
    if (result.action === "discarded") return { kind: "discarded" };
    // "saved" — revalidate rather than trust it (WI-5), but distinguish the
    // two ways isDirty can still stand: save-time normalization (hard-break
    // style) makes markSaved compare the SAVED bytes against the untouched
    // buffer, which is not an edit — the buffer being byte-identical to what
    // was just prompted-and-saved means the content is safe on disk, and
    // re-prompting looped three identical dialogs then refused the close
    // (review finding). Changed content is a real mid-save edit: go around.
    flushAllWysiwygNow();
    const after = useDocumentStore.getState().getDocument(tabId);
    if (!after || !needsResolution(after)) return { kind: "clean" };
    if (after.content === contentAtPrompt) {
      return { kind: "clean", settledContent: contentAtPrompt };
    }
  }
  // Still unsettled after the bound — refuse to close rather than drop content.
  return { kind: "cancelled" };
}

/** In-flight closes by tabId — concurrent callers share the outcome (WI-7). */
const inFlightCloses = new Map<string, Promise<boolean>>();

/**
 * Close a tab with dirty check. If the document has unsaved (or divergent)
 * changes, prompts the user to save, don't save, or cancel.
 *
 * Closing the last tab leaves the window open on the Welcome screen rather
 * than closing it (empty-workspace window). Concurrent calls for the same
 * tabId join the in-flight close and resolve to the same outcome.
 *
 * @returns true if tab was closed, false if user cancelled
 */
export async function closeTabWithDirtyCheck(
  windowLabel: string,
  tabId: string
): Promise<boolean> {
  const existing = inFlightCloses.get(tabId);
  if (existing) return existing;

  const run = performTabClose(windowLabel, tabId);
  inFlightCloses.set(tabId, run);
  try {
    return await run;
  } finally {
    inFlightCloses.delete(tabId);
  }
}

async function performTabClose(windowLabel: string, tabId: string): Promise<boolean> {
  const tab = useTabStore.getState().tabs[windowLabel]?.find((t) => t.id === tabId);

  // No tab at all — treat as already closed.
  if (!tab) return true;

  if (tab.isPinned) {
    toast.info(i18n.t("dialog:toast.unpinBeforeClosing"));
    return false;
  }

  // A BROWSER tab has no document, and that is not a defect — it is a web
  // page. Nothing to save, nothing to prompt about — close it.
  if (isBrowserTab(tab)) {
    return useTabStore.getState().closeTab(windowLabel, tabId);
  }

  // A document tab with no document state: close the TAB anyway (WI-6). This
  // state is reachable while a file read is in flight, and reporting success
  // while the tab stays on screen made Cmd+W look dead — and defeated the
  // close-during-open guard, which checks whether the tab still exists.
  if (!useDocumentStore.getState().getDocument(tabId)) {
    const removed = useTabStore.getState().closeTab(windowLabel, tabId);
    if (removed) cleanupTabState(tabId);
    return removed;
  }

  // Resolve → cleanup → revalidate, bounded (WI-5): cleanup does file IO, and
  // an edit landing during it must not be dropped under a stale "clean".
  let resolution: Resolution = { kind: "clean" };
  for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
    resolution = await resolveDirtyState(windowLabel, tabId, tab.title);
    if (resolution.kind === "cancelled") return false;

    // Pinning DURING the prompt is a "keep this around" signal (WI-5).
    const tabNow = useTabStore.getState().tabs[windowLabel]?.find((t) => t.id === tabId);
    if (!tabNow) return true;
    if (tabNow.isPinned) {
      toast.info(i18n.t("dialog:toast.unpinBeforeClosing"));
      return false;
    }

    await cleanupOrphansForClosingTabs([tabId]);

    const after = useDocumentStore.getState().getDocument(tabId);
    if (!after) break;
    if (resolution.kind === "discarded") break; // the user chose to drop it
    if (atRest(after, resolution)) break; // still at rest — safe to close
    // An edit landed during cleanup — go around again.
  }

  const final = useDocumentStore.getState().getDocument(tabId);
  if (final && resolution.kind !== "discarded" && !atRest(final, resolution)) {
    // Could not bring the document to rest — refuse rather than drop content.
    return false;
  }

  const removed = useTabStore.getState().closeTab(windowLabel, tabId);
  if (removed) cleanupTabState(tabId);
  return removed;
}

/**
 * Close multiple tabs with dirty checks.
 * Prompts for each dirty tab. If user cancels any, stops and returns false.
 *
 * @returns true if all tabs were closed, false if user cancelled any
 */
export async function closeTabsWithDirtyCheck(
  windowLabel: string,
  tabIds: string[]
): Promise<boolean> {
  for (const tabId of tabIds) {
    const closed = await closeTabWithDirtyCheck(windowLabel, tabId);
    if (!closed) {
      return false; // User cancelled - stop closing
    }
  }
  return true;
}
