/**
 * Context-aware closed-tab reopen (plan D4).
 *
 * Purpose: the File → Reopen Closed Tab behavior (the `reopenClosedTab`
 * shortcut ships unbound; Mod-Shift-T is Insert Table) for the workspace-rail
 * world. Compares the
 * ACTIVE context's newest closed document with the window-global browser
 * history's newest entry (by close sequence) and reopens the newer one:
 *   - rail on  → the active instance's scope + BROWSER_SCOPE
 *   - rail off → WINDOW_ALL_SCOPE + BROWSER_SCOPE
 *
 * A closed document whose path is already live in the window is SKIPPED
 * (dropped from history and the next candidate tried) rather than duplicated
 * or stolen from its current tab. Activation is pane-aware through
 * `setActiveTab` itself (the activation seam, ADR-1): under a split a reopened document
 * lands in the focused pane; browser tabs activate in place.
 *
 * Content: history keeps tab records only, and the tab-removal bus freed the
 * document at close. A reopened document with a file is therefore read back
 * from disk into the same tab through `replaceTabWithFile` (size gate, media,
 * BOM, ownership, recents — the Open flow's own steps), so it shows the file
 * as it is now. An untitled tab reopens empty: its unsaved edits were not
 * kept. When the file cannot be read (or is refused) the tab is detached
 * again — not closed, so the failure does not re-enter the history.
 *
 * @coordinates-with stores/tabStoreClosedScopes.ts — scoped history
 * @coordinates-with stores/tabActivationBus.ts — setActiveTab is pane-aware
 * @coordinates-with services/navigation/replaceTabWithFile.ts — reads the content back
 * @module services/workspaces/reopenClosedTab
 */
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import {
  WINDOW_ALL_SCOPE,
  useClosedTabScopesStore,
} from "@/stores/tabStoreClosedScopes";
import { BROWSER_SCOPE } from "@/services/workspaces/workspaceOwnershipKernel";
import { initUntitledDocument } from "@/services/navigation/newFile";
import { replaceTabWithFile } from "@/services/navigation/replaceTabWithFile";
import { openFailureDetail } from "@/services/files/openFailureDetail";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { fileOpsError } from "@/utils/debug";

function candidateScopes(windowLabel: string): string[] {
  const railEnabled = useSettingsStore.getState().general?.workspaceRailMode ?? false;
  if (!railEnabled) return [WINDOW_ALL_SCOPE, BROWSER_SCOPE];
  const activeId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  // WINDOW_ALL_SCOPE stays a candidate: tabs closed before any instance
  // existed (or with no owner) should still be reopenable.
  return activeId
    ? [activeId, WINDOW_ALL_SCOPE, BROWSER_SCOPE]
    : [WINDOW_ALL_SCOPE, BROWSER_SCOPE];
}

/** True when reopening this closed document would duplicate a live path. */
function isPathAlreadyLive(windowLabel: string, tab: Tab): boolean {
  if (tab.kind !== "document" || !tab.filePath) return false;
  return useTabStore.getState().findTabByPath(windowLabel, tab.filePath) !== null;
}

/**
 * Reopen the newest closed tab of the window's ACTIVE context. Resolves to the
 * reopened tab, or null when every candidate history is empty or the reopened
 * document could not be loaded.
 */
export async function reopenClosedTabForActiveContext(windowLabel: string): Promise<Tab | null> {
  const scopes = useClosedTabScopesStore.getState();
  const keys = candidateScopes(windowLabel);

  for (;;) {
    const newest = scopes.newestEntry(windowLabel, keys);
    if (!newest) return null;

    const tab = scopes.takeClosedTab(windowLabel, newest.scopeKey, newest.entry.tab.id);
    if (!tab) return null; // raced away — nothing sane to do

    if (isPathAlreadyLive(windowLabel, tab)) {
      // Skipped, not duplicated or stolen (D4) — try the next candidate.
      continue;
    }

    useTabStore.getState().restoreTab(windowLabel, tab);
    useTabStore.getState().setActiveTab(windowLabel, tab.id); // pane-aware
    return (await loadReopenedContent(windowLabel, tab)) ? tab : null;
  }
}

/** Give a restored tab its document back. False when it was detached instead. */
async function loadReopenedContent(windowLabel: string, tab: Tab): Promise<boolean> {
  if (tab.kind !== "document") return true;
  if (!tab.filePath) {
    initUntitledDocument(tab.id);
    return true;
  }
  const result = await replaceTabWithFile({
    windowLabel,
    tabId: tab.id,
    targetPath: tab.filePath,
    sourcePath: tab.filePath,
  });
  if (result.ok) return true;
  useTabStore.getState().detachTab(windowLabel, tab.id);
  if (!result.cancelled) {
    fileOpsError("Failed to reopen closed tab:", tab.filePath, result.error);
    toast.errorDetail(i18n.t("dialog:toast.failedToOpenFile"), openFailureDetail(result.error));
  }
  return false;
}
