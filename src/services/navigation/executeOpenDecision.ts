/**
 * Purpose: EXECUTE a resolved open decision — activate, create, replace, or
 * open a new window — with the error handling each branch needs.
 *
 * Split out of `fileOpen.ts`, where `handleOpen` was a ~120-line routine doing
 * dialog construction, policy resolution, and branch execution at once.
 *
 * Key decisions:
 *   - A failed workspace open is REPORTED, not swallowed. The file still opens
 *     (the user asked for the file, not the workspace), but silently claiming
 *     it under the previous context contradicted the ordering requirement in
 *     #946 and gave no clue why the sidebar showed the wrong root.
 *
 * @coordinates-with services/navigation/fileOpen.ts — the caller
 * @coordinates-with utils/openPolicy.ts — resolveOpenAction produces the decision
 * @module services/navigation/executeOpenDecision
 */
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { openWorkspaceWithConfig } from "@/services/workspaces/openWorkspaceWithConfig";
import { activateTabWithWorkspaceContext } from "@/services/workspaces/activateTabWithWorkspaceContext";
import { replaceTabWithFile } from "@/services/navigation/replaceTabWithFile";
import { fileOpsError } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";
import { perfMark } from "@/utils/perfLog";
import type { OpenActionResult } from "@/utils/openPolicy/types";

/**
 * Open an external file's resolved workspace before creating its tab (#946).
 *
 * Returns false only when a workspace was requested and could not be opened —
 * the caller decides what to tell the user. Returning void here meant the
 * caller could not distinguish "no workspace to open" from "the workspace
 * failed", so it treated both as success and opened the file under the
 * previous context in silence.
 */
async function openWorkspaceForNewTab(
  windowLabel: string,
  workspaceRoot: string | null | undefined,
): Promise<boolean> {
  if (!workspaceRoot) return true;
  try {
    await openWorkspaceWithConfig(workspaceRoot, { windowLabel });
    return true;
  } catch (error) {
    fileOpsError("Failed to open workspace for new tab:", error);
    return false;
  }
}


/** Carry out `decision` for `path` in `windowLabel`. */
export async function executeOpenDecision(
  windowLabel: string,
  path: string,
  decision: OpenActionResult,
  openFileInNewTab: (windowLabel: string, path: string) => Promise<void>,
): Promise<void> {
  switch (decision.action) {
    case "activate_tab":
      // WI-12.2 (from main): ownership-aware — the visible workspace follows
      // the tab's owner. A plain setActiveTab leaves the sidebar on the
      // previous workspace while the editor shows a file from another one.
      activateTabWithWorkspaceContext(windowLabel, decision.tabId);
      perfMark("handleOpen:activatedTab");
      break;
    case "create_tab":
      // fix(#946) — an external file opened in a new tab carries its own
      // resolved root; open that workspace first so it's claimed by its own
      // context, not the current one.
      // The file opens either way — the user asked for the file, not the
      // workspace — but a silent failure left it claimed by the WRONG
      // context with no sign anything went wrong, which contradicts the
      // stated ordering requirement (#946).
      if (!(await openWorkspaceForNewTab(windowLabel, decision.workspaceRoot))) {
        toast.warning(i18n.t("dialog:toast.openWorkspaceForFileFailed"), { pin: true });
      }
      await openFileInNewTab(windowLabel, path);
      perfMark("handleOpen:createdTab");
      break;
    case "replace_tab": {
      // Replace the clean untitled tab with the file content via the shared
      // helper (also used by "Open Recent File").
      const replaceResult = await replaceTabWithFile({
        windowLabel,
        tabId: decision.tabId,
        targetPath: decision.filePath,
        sourcePath: path,
        workspaceRoot: decision.workspaceRoot,
      });
      if (replaceResult.ok) {
        perfMark("handleOpen:replacedTab");
      } else if (replaceResult.cancelled) {
        perfMark("handleOpen:replaceTabRefusedOrCancelled");
      } else {
        fileOpsError("Failed to replace tab with file:", replaceResult.error);
        const msg = errorMessage(replaceResult.error);
        // Pin: system error includes paths and codes the user may want
        // to copy to investigate (permission denied, missing file, etc.)
        toast.error(i18n.t("dialog:toast.fileOpenFailed", { error: msg }), {
          pin: true,
        });
      }
      break;
    }
    case "open_workspace_in_new_window":
      try {
        await invoke("open_workspace_in_new_window", {
          workspaceRoot: decision.workspaceRoot,
          filePath: decision.filePath,
        });
      } catch (error) {
        fileOpsError("Failed to open workspace in new window:", error);
        toast.error(i18n.t("dialog:toast.openWorkspaceInNewWindowFailed"));
      }
      break;
    case "no_op":
      // Nothing to do
      break;
  }
}
