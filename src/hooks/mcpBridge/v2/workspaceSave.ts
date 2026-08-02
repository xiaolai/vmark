/**
 * Purpose: `vmark.workspace.save` handler — persist a tab's buffer to
 * its file path. Extracted from workspace.ts (size baseline); re-exported
 * there so dispatch imports are unchanged.
 *
 * @coordinates-with workspace.ts — sibling workspace handlers
 * @coordinates-with services/coherence/captureFunnel.ts — inferred MCP capture (WI-1.6)
 * @module hooks/mcpBridge/v2/workspaceSave
 */

import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { registerPendingSave, clearPendingSave } from "@/utils/pendingSaves";
import { captureMcpWrite } from "@/services/coherence/captureFunnel";
import { checkBridgePath } from "@/services/mcpBridge/bridgePathGuard";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { respond } from "../utils";
import { v2ErrorString } from "./types";
import { wrapHandler } from "./wrapHandler";
import type { V2Error } from "./types";

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

interface SaveResolution {
  tabId: string;
  filePath: string;
  content: string;
}

function resolveTabForSave(
  tabIdArg: string | undefined,
): SaveResolution | V2Error {
  const tabState = useTabStore.getState();
  const docState = useDocumentStore.getState();

  let tabId: string;
  if (tabIdArg) {
    if (
      !Object.values(tabState.tabs).some((list) =>
        list.some((t) => t.id === tabIdArg),
      )
    ) {
      return { error: "INVALID_TAB", message: "Unknown tabId" };
    }
    tabId = tabIdArg;
  } else {
    const focused = getCurrentWindowLabel();
    const active = tabState.activeTabId[focused];
    if (!active) {
      return { error: "INVALID_TAB", message: "No focused tab" };
    }
    tabId = active;
  }
  const doc = docState.documents[tabId];
  if (!doc) {
    return { error: "INVALID_TAB", message: "No document for tab" };
  }
  if (!doc.filePath) {
    return {
      error: "INVALID_PATH",
      message: "Tab has no filePath; use save_as instead",
    };
  }
  return { tabId, filePath: doc.filePath, content: doc.content };
}

/**
 * Handle `vmark.workspace.save`. Args: `{tabId?: string}`.
 */
export async function handleWorkspaceSave(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const resolved = resolveTabForSave(tabIdArg);
    if ("error" in resolved) {
      await structuredError(id, resolved);
      return;
    }
    // Defense in depth: a tab's own path is always within an allowed root,
    // but guard the write anyway so every bridge disk write goes through the
    // same scope check.
    const saveDecision = await checkBridgePath(resolved.filePath);
    if (!saveDecision.allowed) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: saveDecision.reason,
      });
      return;
    }
    const saveToken = registerPendingSave(resolved.filePath, resolved.content);
    try {
      await writeTextFile(resolved.filePath, resolved.content);
      // Verbatim write: both snapshots are the same string here.
      useDocumentStore
        .getState()
        .markSaved(resolved.tabId, {
          editorSnapshot: resolved.content,
          diskSnapshot: resolved.content,
        });
      // Coherence (WI-1.6): inferred capture, session-read inputs.
      void captureMcpWrite({
        absolutePath: resolved.filePath,
        content: resolved.content,
        toolName: "workspace.save",
      }).catch(() => {});
    } finally {
      // Delayed clear (audit T9): same watcher window as saveToPath.
      const filePath = resolved.filePath;
      setTimeout(() => clearPendingSave(filePath, saveToken), 1000);
    }
    const revision = useRevisionStore.getState().getRevision(resolved.tabId);
    await respond({
      id,
      success: true,
      data: { filePath: resolved.filePath, revision },
    });
  });
}
