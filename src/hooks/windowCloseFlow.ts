/**
 * Window Close Flow
 *
 * Purpose: the whole-window close transaction — resolve every dirty document,
 * honour pins, run orphan cleanup, persist the session, and only then close
 * the native window. Extracted from useWindowClose so the hook is listener
 * wiring and this is testable orchestration.
 *
 * Key decisions:
 *   - Dirty AND divergent documents need resolution (WI-2), same rule as the
 *     per-tab close.
 *   - The dirty set is REVALIDATED after the prompts (WI-5): saves and dialogs
 *     yield, and an edit (human or MCP) landing mid-await must produce another
 *     prompt, not a silent discard. Bounded — a document that cannot be
 *     brought to rest cancels the close. A doc the user explicitly discarded
 *     is exempt from re-checks: that choice covers whatever the buffer holds.
 *   - NOTHING is destroyed until `close_window` is invoked (WI-3). Cleanup and
 *     persistence read live stores; the store teardown runs after the native
 *     close call, so a rejected persist or close leaves the window fully
 *     intact instead of alive-but-empty. On success the webview dies and the
 *     teardown is moot.
 *   - The tab list for teardown is re-read at finalize time — tabs opened
 *     during a prompt are included instead of leaking.
 *   - One-pass dirty-context construction (WI-8e): there is no await between
 *     the filter and the map, so the old two-pass null-filter was dead code
 *     reachable only through a fabricated test.
 *
 * @coordinates-with useWindowClose.ts — sole caller (owns listeners + in-flight sharing)
 * @coordinates-with closeSave.ts — the prompts
 * @coordinates-with services/media/closeCleanup.ts — orphan cleanup before teardown
 * @module hooks/windowCloseFlow
 */

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useDocumentStore, type DocumentState } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import {
  promptSaveForDirtyDocument,
  promptSaveForMultipleDocuments,
  type CloseSaveContext,
} from "@/hooks/closeSave";
import { cleanupOrphansForClosingTabs } from "@/services/media/closeCleanup";
import { persistWorkspaceSession } from "@/services/workspaces/workspaceSession";
import type { Tab } from "@/stores/tabStoreTypes";

export type CloseLog = (label: string, ...args: unknown[]) => void;

/** Same close-resolution rule as the per-tab path (WI-2). */
function needsResolution(doc: Pick<DocumentState, "isDirty" | "isDivergent">): boolean {
  return doc.isDirty || doc.isDivergent;
}

/** Bounded prompt→revalidate iterations; see useTabOperations for the rationale. */
const MAX_RESOLUTION_ATTEMPTS = 3;

/** One synchronous pass — no await separates the check from the context (WI-8e). */
function collectDirtyContexts(
  windowLabel: string,
  tabs: Tab[],
  discarded: ReadonlySet<string>
): CloseSaveContext[] {
  const contexts: CloseSaveContext[] = [];
  for (const tab of tabs) {
    if (discarded.has(tab.id)) continue;
    const doc = useDocumentStore.getState().getDocument(tab.id);
    if (!doc || !needsResolution(doc)) continue;
    contexts.push({
      windowLabel,
      tabId: tab.id,
      title: doc.filePath || tab.title,
      filePath: doc.filePath,
      content: doc.content,
      divergent: !doc.isDirty && doc.isDivergent,
    });
  }
  return contexts;
}

/** Ask once about pinned tabs; the pin is a "keep this around" signal. */
async function confirmPinnedTabs(tabs: Tab[], log: CloseLog, windowLabel: string): Promise<boolean> {
  const pinnedTabs = tabs.filter((tab) => tab.isPinned);
  if (pinnedTabs.length === 0) return true;
  const confirmed = await ask(
    i18n.t("dialog:windowClose.pinnedPrompt", { count: pinnedTabs.length }),
    {
      title: i18n.t("dialog:windowClose.pinnedTitle"),
      kind: "warning",
      okLabel: i18n.t("dialog:windowClose.confirmClose"),
      cancelLabel: i18n.t("dialog:common.cancel"),
    }
  );
  if (!confirmed) log(windowLabel, "close cancelled by pinned-tabs prompt");
  return confirmed;
}

/**
 * The point of no return — but ordered so failure destroys nothing (WI-3):
 * cleanup and persistence first (they READ the stores), then the native close,
 * and store teardown only after that call is issued. If `close_window`
 * rejects, every document, tab and pane is still intact.
 */
async function finalizeWindowClose(windowLabel: string, log: CloseLog): Promise<true> {
  // Fresh list: tabs opened during the prompts close with the window too.
  const tabIds = (useTabStore.getState().tabs[windowLabel] ?? []).map((t) => t.id);
  await cleanupOrphansForClosingTabs(tabIds);
  await persistWorkspaceSession(windowLabel);
  log(windowLabel, "invoking close_window with label:", windowLabel);
  await invoke("close_window", { label: windowLabel });
  log(windowLabel, "close_window returned");
  // On success the webview is being destroyed and may never reach this line —
  // which is fine: the teardown only matters if the window SURVIVES.
  tabIds.forEach((id) => useDocumentStore.getState().removeDocument(id));
  useTabStore.getState().removeWindow(windowLabel);
  usePaneStore.getState().removeWindow(windowLabel); // #1081 M3
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
  let promptedForDirty = false;

  for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
    const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
    log(windowLabel, "tabs state:", {
      windowLabel,
      tabCount: tabs.length,
      tabIds: tabs.map((t) => t.id),
    });

    const dirtyContexts = collectDirtyContexts(windowLabel, tabs, discarded);

    if (dirtyContexts.length === 0) {
      // The pin prompt is skipped when a save dialog already interrupted
      // intent — stacking a second prompt is friction-on-friction.
      if (!promptedForDirty && !(await confirmPinnedTabs(tabs, log, windowLabel))) {
        return false;
      }
      log(windowLabel, "all documents at rest, closing window");
      return finalizeWindowClose(windowLabel, log);
    }

    promptedForDirty = true;
    if (dirtyContexts.length === 1) {
      const result = await promptSaveForDirtyDocument(dirtyContexts[0]);
      if (result.action === "cancelled") return false;
      if (result.action === "discarded") discarded.add(dirtyContexts[0].tabId);
    } else {
      const result = await promptSaveForMultipleDocuments(dirtyContexts);
      if (result.action === "cancelled") return false;
      if (result.action === "discarded-all") {
        dirtyContexts.forEach((ctx) => discarded.add(ctx.tabId));
      }
    }
    // Loop: revalidate. A doc still dirty after "saved" means an edit landed
    // during the save (WI-5) — it gets another prompt, not a silent drop.
  }

  // Documents kept changing faster than they could be resolved — refuse.
  log(windowLabel, "close abandoned: documents would not come to rest");
  return false;
}
