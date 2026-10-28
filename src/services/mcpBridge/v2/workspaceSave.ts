/**
 * Purpose: `vmark.workspace.save` handler — persist a tab's buffer to
 * its file path, through the same save pipeline a human save uses.
 * Extracted from workspace.ts (size baseline); re-exported there so dispatch
 * imports are unchanged.
 *
 * What is saved is the buffer with the editor's pending keystrokes already in
 * it: the tab guard flushes the mounted editors before it reads, as the human
 * Save does — otherwise the reply says "saved" one frame before the document
 * turns dirty again.
 *
 * The reply's `journaled` says whether the agent edit journal recorded the
 * saved text ("yes" | "pending" | "no"); "no" is still a saved file.
 *
 * @coordinates-with workspace.ts — sibling workspace handlers
 * @coordinates-with tabGuard.ts — tab resolution, the flush, INVALID_TAB
 * @coordinates-with bridgeSave.ts — the path guard and the save pipeline
 * @module services/mcpBridge/v2/workspaceSave
 */

import { useRevisionStore } from "@/stores/documentStore";
import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { respondSaveFailed, saveTabForBridge } from "./bridgeSave";
import { readOperationArgs } from "./readOperationArgs";
import { requireTab, structuredError } from "./tabGuard";

/**
 * Handle `vmark.workspace.save`. Args: `{tabId?: string}`.
 *
 * `context` names the client asking: the save's provenance is recorded as its
 * write, with the documents it read on its connection as inputs.
 */
export async function handleWorkspaceSave(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext,
): Promise<void> {
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.workspace.save", args);
    const tab = await requireTab(id, wire.tabId);
    if (!tab) return;
    if (!tab.filePath) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: "Tab has no filePath; use save_as instead",
      });
      return;
    }
    const outcome = await saveTabForBridge(tab.tabId, tab.filePath, tab.content, "workspace.save", context);
    if (!outcome.saved) {
      await respondSaveFailed(id, outcome);
      return;
    }
    const revision = useRevisionStore.getState().getRevision(tab.tabId);
    await respond({
      id,
      success: true,
      data: { filePath: tab.filePath, revision, journaled: outcome.journaled },
    });
  });
}
