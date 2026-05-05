/**
 * Purpose: WI-B.2 helper — open a workspace-local action / reusable
 *   workflow file in a new tab when the user Cmd-Clicks a `uses:`
 *   reference. If a tab already exists for that filePath, focuses it
 *   instead of duplicating.
 *
 *   The CodeMirror integration is in
 *   `src/plugins/codemirror/sourceWorkflowGoto.ts`.
 *
 * @coordinates-with src/lib/ghaWorkflow/paths.ts — ref resolution
 * @coordinates-with src/hooks/useFinderFileOpen.ts — load-into-tab pipeline
 * @module hooks/useOpenWorkflowTarget
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { loadFileIntoTab } from "./useFinderFileOpen";

export interface OpenResult {
  ok: boolean;
  reason?: "missing" | "load-failed";
}

/**
 * Open a local file as a tab in the given window. If a tab already
 * tracks that absolute path, switch to it. Otherwise create a new
 * tab and load the file.
 */
export async function openLocalFileInTab(
  windowLabel: string,
  absPath: string,
): Promise<OpenResult> {
  // Already-open: find an existing tab with this filePath.
  const docs = useDocumentStore.getState().documents;
  for (const tab of useTabStore.getState().tabs[windowLabel] ?? []) {
    const fp = docs[tab.id]?.filePath;
    if (fp === absPath) {
      useTabStore.getState().setActiveTab(windowLabel, tab.id);
      return { ok: true };
    }
  }
  // Not yet open: create a new tab + load.
  const tabId = useTabStore.getState().createTab(windowLabel, absPath);
  try {
    await loadFileIntoTab(tabId, absPath, true);
  } catch {
    useTabStore.getState().detachTab(windowLabel, tabId);
    return { ok: false, reason: "load-failed" };
  }
  useTabStore.getState().setActiveTab(windowLabel, tabId);
  return { ok: true };
}
