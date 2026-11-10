/**
 * Window Close Flow
 *
 * Purpose: the whole-window close transaction — resolve every dirty document,
 * honour pins, run orphan cleanup, persist the session, and only then close
 * the native window. Extracted from useWindowClose so the hook is listener
 * wiring and this is testable orchestration.
 *
 * Key decisions:
 *   - Dirty AND divergent documents need resolution, same rule as the
 *     per-tab close.
 *   - The dirty set is REVALIDATED after EVERY await: save prompts, the
 *     pin dialog, and the cleanup/persist steps inside finalize all yield, and
 *     an edit (human or MCP) landing mid-await must produce another prompt,
 *     not a silent discard. Bounded — a document that cannot be brought to
 *     rest cancels the close. Two exemptions: a doc the user explicitly
 *     discarded (that choice covers whatever the buffer holds), and a doc
 *     whose buffer is byte-identical to a completed save (save-time
 *     normalization can leave isDirty standing with the bytes safely on disk).
 *   - NOTHING is destroyed until `close_window` is invoked. Cleanup and
 *     persistence read live stores; the store teardown runs after the native
 *     close call, so a rejected persist or close leaves the window fully
 *     intact instead of alive-but-empty. On success the webview dies and the
 *     teardown is moot.
 *   - The tab list for teardown is re-read at finalize time — tabs opened
 *     during a prompt are included instead of leaking.
 *   - One-pass dirty-context construction, in dirtyContexts.ts: there
 *     is no await between the filter and the map, so the old two-pass
 *     null-filter was dead code reachable only through a fabricated test.
 *
 * @coordinates-with useWindowClose.ts — sole caller (owns listeners + in-flight sharing)
 * @coordinates-with closeSave.ts — the prompts
 * @coordinates-with dirtyContexts.ts — which tabs still need saving, and the loop bound
 * @coordinates-with services/media/closeCleanup.ts — orphan cleanup before teardown
 * @module services/windowClose/windowCloseFlow
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { promptSaveForDirtyDocument, promptSaveForMultipleDocuments } from "./closeSave";
import { collectDirtyContexts, MAX_RESOLUTION_ATTEMPTS } from "./dirtyContexts";
import { cleanupOrphansForClosingTabs } from "@/services/media/closeCleanup";
import { persistWorkspaceSession } from "@/services/workspaces/workspaceSession";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import type { Tab } from "@/stores/tabStoreTypes";
import { retireRecoveryTabs, unretireRecoveryTabs } from "@/services/persistence/crashRecovery";
import { confirmAction } from "@/services/dialogs/confirmAction";

export type CloseLog = (label: string, ...args: unknown[]) => void;

/** Ask once about pinned tabs; the pin is a "keep this around" signal. */
async function confirmPinnedTabs(tabs: Tab[], log: CloseLog, windowLabel: string): Promise<boolean> {
  const pinnedTabs = tabs.filter((tab) => tab.isPinned);
  if (pinnedTabs.length === 0) return true;
  const confirmed = await confirmAction({
    title: i18n.t("dialog:windowClose.pinnedTitle"),
    message: i18n.t("dialog:windowClose.pinnedPrompt", { count: pinnedTabs.length }),
    actionLabel: i18n.t("dialog:windowClose.confirmClose"),
    kind: "warning",
  });
  if (!confirmed) log(windowLabel, "close cancelled by pinned-tabs prompt");
  return confirmed;
}

/**
 * The point of no return — but ordered so failure destroys nothing:
 * cleanup and persistence first (they READ the stores), then the native close,
 * and store teardown only after that call is issued. If `close_window`
 * rejects, every document, tab and pane is still intact.
 *
 * Returns false when an edit landed DURING cleanup/persistence — both are
 * awaits, and a buffer dirtied mid-await would be destroyed by the teardown
 * below (review finding). The caller loops back to the prompts.
 */
async function finalizeWindowClose(
  windowLabel: string,
  discarded: ReadonlySet<string>,
  settled: ReadonlyMap<string, string>,
  log: CloseLog
): Promise<boolean> {
  // Fresh list: tabs opened during the prompts close with the window too.
  const tabIds = (useTabStore.getState().tabs[windowLabel] ?? []).map((t) => t.id);
  await cleanupOrphansForClosingTabs(tabIds);
  await persistWorkspaceSession(windowLabel);

  // Recovery snapshots go BEFORE the last-instant check below, because the
  // delete yields. At this point every document is saved, clean or explicitly
  // discarded, so none may outlive the window. Awaited, ahead of the native
  // close: on a quit the process exits right behind the last window, and a
  // fire-and-forget delete never finished — the discarded text came back on
  // the next launch. Undone below if the window is not closing after all.
  const retiredIds = (useTabStore.getState().tabs[windowLabel] ?? []).map((t) => t.id);
  await retireRecoveryTabs(retiredIds);

  // Last-instant revalidation: nothing below this check yields, so a buffer
  // clean HERE cannot be dirtied before the teardown runs.
  flushAllWysiwygNow();
  const freshTabs = useTabStore.getState().tabs[windowLabel] ?? [];
  if (collectDirtyContexts(windowLabel, freshTabs, discarded, settled).length > 0) {
    log(windowLabel, "edit landed during finalize — re-prompting");
    unretireRecoveryTabs(retiredIds);
    return false;
  }

  // `close_window` closes the window that asks, which is this one.
  log(windowLabel, "invoking close_window");
  try {
    await invoke("close_window");
  } catch (error) {
    // The window survives: its dirty documents are crash-recoverable again.
    unretireRecoveryTabs(retiredIds);
    throw error;
  }
  log(windowLabel, "close_window returned");
  // On success the webview is being destroyed and may never reach this line —
  // which is fine: the teardown only matters if the window SURVIVES. Dropping
  // the window's tab list announces every tab's removal, which frees each
  // document and the rest of its per-tab state — including a tab opened while
  // the native close was in flight.
  useTabStore.getState().removeWindow(windowLabel);
  usePaneStore.getState().removeWindow(windowLabel); // #1081 M3
  // R3-5: the closed-tab reopen history is per-window state too — without
  // this, a surviving process (window closed, app alive) kept every closed
  // window's scopes forever, and the action had no production caller at all.
  useClosedTabScopesStore.getState().removeWindowClosedScopes(windowLabel);
  return true;
}

/**
 * Run the whole-window close: prompts, revalidation, finalize.
 * Returns false when the user cancelled or the close could not proceed.
 */
export async function runWindowCloseFlow(
  windowLabel: string,
  log: CloseLog
): Promise<boolean> {
  const discarded = new Set<string>();
  /** tabId → content at a COMPLETED save; residual dirt on it is artifact. */
  const settled = new Map<string, string>();
  let promptedForDirty = false;
  let pinsConfirmed = false;

  for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
    // Sync every mounted editor before judging dirtiness — an edit
    // still in the debounce window is otherwise invisible to the check.
    flushAllWysiwygNow();
    const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
    log(windowLabel, "tabs state:", {
      windowLabel,
      tabCount: tabs.length,
      tabIds: tabs.map((t) => t.id),
    });

    const dirtyContexts = collectDirtyContexts(windowLabel, tabs, discarded, settled);

    if (dirtyContexts.length === 0) {
      // The pin prompt is skipped when a save dialog already interrupted
      // intent — stacking a second prompt is friction-on-friction.
      if (!promptedForDirty && !pinsConfirmed && tabs.some((t) => t.isPinned)) {
        if (!(await confirmPinnedTabs(tabs, log, windowLabel))) return false;
        pinsConfirmed = true;
        // The dialog was an await — loop back and revalidate before
        // finalizing: an edit (human or MCP) can land while it sits open.
        continue;
      }
      log(windowLabel, "all documents at rest, closing window");
      if (await finalizeWindowClose(windowLabel, discarded, settled, log)) return true;
      continue; // an edit landed during cleanup/persist — prompt for it
    }

    promptedForDirty = true;
    if (dirtyContexts.length === 1) {
      const result = await promptSaveForDirtyDocument(dirtyContexts[0]);
      if (result.action === "cancelled") return false;
      if (result.action === "discarded") discarded.add(dirtyContexts[0].tabId);
      if (result.action === "saved") settled.set(dirtyContexts[0].tabId, dirtyContexts[0].content);
    } else {
      const result = await promptSaveForMultipleDocuments(dirtyContexts);
      if (result.action === "cancelled") return false;
      if (result.action === "discarded-all") {
        dirtyContexts.forEach((ctx) => discarded.add(ctx.tabId));
      }
      if (result.action === "saved-all") {
        dirtyContexts.forEach((ctx) => settled.set(ctx.tabId, ctx.content));
      }
    }
    // Loop: revalidate. A doc still dirty after "saved" with CHANGED content
    // means an edit landed during the save — it gets another prompt,
    // not a silent drop. Unchanged content is a normalization artifact and is
    // exempted via `settled` above.
  }

  // Documents kept changing faster than they could be resolved — refuse.
  log(windowLabel, "close abandoned: documents would not come to rest");
  return false;
}
