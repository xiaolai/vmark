/**
 * Purpose: `vmark.workspace.save_as` handler.
 *
 * Kept separate from `workspace.ts` because save-as carries the bridge's
 * approval, path-boundary and overwrite policy.
 *
 * Key decision: `autoApproveEdits` authorises saving to a NEW location, never
 * destroying an existing one. The allowed roots include the parent directory
 * of every open document, so without that split an auto-approved save_as
 * could silently overwrite any sibling of any open file (audit 20260728 §1.5).
 */

import {
  reassignTabOwnershipForPath,
  windowLabelForTab,
} from "@/services/workspaces/reassignTabOwnershipForPath";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getFileName, normalizePath } from "@/utils/paths";
import { registerPendingSave, clearPendingSave } from "@/utils/pendingSaves";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { checkBridgePath } from "@/services/mcpBridge/bridgePathGuard";
import { imeToast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { v2ErrorString } from "./types";
import type { V2Error } from "./types";

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

function resolveTab(tabIdArg: string | undefined): string | V2Error {
  const tabState = useTabStore.getState();
  if (tabIdArg) {
    const exists = Object.values(tabState.tabs).some((list) =>
      list.some((t) => t.id === tabIdArg),
    );
    return exists ? tabIdArg : { error: "INVALID_TAB", message: "Unknown tabId" };
  }
  const active = tabState.activeTabId[getCurrentWindowLabel()];
  return active ?? { error: "INVALID_TAB", message: "No focused tab" };
}

export async function handleWorkspaceSaveAs(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const filePath = args.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: "filePath must be a non-empty string",
      });
      return;
    }

    const decision = await checkBridgePath(filePath);
    if (!decision.allowed) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: decision.reason,
      });
      return;
    }

    const tabId = resolveTab(typeof args.tabId === "string" ? args.tabId : undefined);
    if (typeof tabId !== "string") {
      await structuredError(id, tabId);
      return;
    }

    const tabState = useTabStore.getState();
    const docState = useDocumentStore.getState();
    const doc = docState.documents[tabId];
    if (!doc) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "No document for tab",
      });
      return;
    }

    const autoApprove =
      useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
    const sameOpenPath =
      doc.filePath != null &&
      normalizePath(doc.filePath) === normalizePath(filePath);
    if (!autoApprove && !sameOpenPath) {
      imeToast.warning(
        i18n.t("dialog:toast.mcpApprovalRequired", {
          filename: getFileName(filePath) || filePath,
        }),
      );
      await structuredError(id, {
        error: "APPROVAL_REQUIRED",
        message:
          "Saving to a new location requires user approval (autoApproveEdits is off)",
      });
      return;
    }

    // WI-5: `autoApproveEdits` authorises saving to a NEW location — it does
    // not authorise destroying an existing one. The bridge's allowed roots
    // include the parent directory of every open document, so without this an
    // auto-approved save_as could silently overwrite any sibling of any open
    // file. Saving over the tab's own path is a save, not a clobber.
    if (!sameOpenPath && (await exists(filePath))) {
      const name = getFileName(filePath) || filePath;
      imeToast.warning(
        i18n.t("dialog:toast.mcpApprovalRequired", { filename: name }),
      );
      await structuredError(id, {
        error: "APPROVAL_REQUIRED",
        message:
          `Refusing to overwrite the existing file ${name}. ` +
          `save_as will not replace a file that is not the tab's own path. ` +
          `Choose a different filePath, or have the user open ${name} and save over it deliberately.`,
      });
      return;
    }

    const saveToken = registerPendingSave(filePath, doc.content);
    try {
      await writeTextFile(filePath, doc.content);
    } finally {
      clearPendingSave(filePath, saveToken);
    }
    tabState.updateTabPath(tabId, filePath);
    // WI-13.4/D10: AI-driven Save As reclassifies ownership but never yanks
    // the human's visible workspace.
    {
      const ownerWindow = windowLabelForTab(tabId);
      if (ownerWindow) {
        reassignTabOwnershipForPath(ownerWindow, tabId, filePath, { allowVisibleSwitch: false });
      }
    }
    tabState.updateTabTitle(tabId, getFileName(filePath) || "Untitled");
    docState.setFilePath(tabId, filePath);
    // Verbatim write: both snapshots are the same string here.
    docState.markSaved(tabId, { editorSnapshot: doc.content, diskSnapshot: doc.content });
    const revision = useRevisionStore.getState().getRevision(tabId);
    await respond({ id, success: true, data: { revision } });
  });
}
