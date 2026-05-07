/**
 * Purpose: `vmark.workspace.*` handlers — file and window lifecycle.
 *
 *   Covers `new`, `open`, `save`, `save_as`, `close`, `switch_tab`, and
 *   `focus_window`. All operate at the file/window boundary; nothing
 *   in-document. The pruned MCP surface relies on these for everything
 *   the AI cannot derive from text round-trip alone.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md, work item WI-1.2.
 *
 * Key decisions:
 *   - `tabId`-based addressing, not `windowId` + "active tab" implicit.
 *     The session.get_state response gives the AI an explicit `tabId`
 *     for every tab; addressing through that is unambiguous.
 *   - `close` requires `force: true` to discard a dirty tab. Default
 *     behavior returns `{closed: false, reason: "DIRTY"}`. The AI must
 *     opt into destruction.
 *   - `new` and `open` accept an optional `windowLabel` so a
 *     multi-window workflow can target a specific window; default is
 *     focused.
 *
 * @coordinates-with stores/tabStore.ts — createTab, closeTab, setActiveTab
 * @coordinates-with stores/documentStore.ts — initDocument, markSaved
 * @coordinates-with utils/saveToPath.ts — disk write with revision tracking
 * @coordinates-with utils/workspaceStorage.ts — getCurrentWindowLabel
 * @module hooks/mcpBridge/v2/workspace
 */

import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/revisionStore";
import { getFileName } from "@/utils/paths";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { respond } from "../utils";
import { v2ErrorString } from "./types";
import type { V2Error } from "./types";

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

function getWindowLabel(args: Record<string, unknown>): string {
  const explicit = args.windowLabel;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return getCurrentWindowLabel();
}

/**
 * Handle `vmark.workspace.new`. Creates a new untitled tab in the
 * focused (or specified) window. Args: `{kind?, windowLabel?}`.
 */
export async function handleWorkspaceNew(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const windowLabel = getWindowLabel(args);
    const tabId = tabStore.createTab(windowLabel, null);
    docStore.initDocument(tabId, "", null);
    await respond({ id, success: true, data: { tabId } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle `vmark.workspace.open`. Reads `filePath` from disk and opens
 * it in a new tab. Args: `{filePath: string, windowLabel?: string}`.
 */
export async function handleWorkspaceOpen(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const filePath = args.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: "filePath must be a non-empty string",
      });
      return;
    }
    let content: string;
    try {
      content = await readTextFile(filePath);
    } catch (e) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: `Failed to read ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const windowLabel = getWindowLabel(args);
    const tabId = tabStore.createTab(windowLabel, filePath);
    // WI-2.6 — registry handles YAML routing; the force-source
    // bandaid is retired. .yaml/.yml files now route to the YAML
    // adapter (kind: split-pane), bypassing the markdown surface.
    docStore.initDocument(tabId, content, filePath);
    await respond({ id, success: true, data: { tabId } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
  try {
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const resolved = resolveTabForSave(tabIdArg);
    if ("error" in resolved) {
      await structuredError(id, resolved);
      return;
    }
    await writeTextFile(resolved.filePath, resolved.content);
    useDocumentStore
      .getState()
      .markSaved(resolved.tabId, resolved.content);
    const revision = useRevisionStore.getState().getRevision();
    await respond({
      id,
      success: true,
      data: { filePath: resolved.filePath, revision },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle `vmark.workspace.save_as`.
 *
 * Args: `{tabId?: string, filePath: string}`.
 */
export async function handleWorkspaceSaveAs(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const filePath = args.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: "filePath must be a non-empty string",
      });
      return;
    }
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const tabState = useTabStore.getState();
    const docState = useDocumentStore.getState();

    let tabId: string;
    if (tabIdArg) {
      if (
        !Object.values(tabState.tabs).some((list) =>
          list.some((t) => t.id === tabIdArg),
        )
      ) {
        await structuredError(id, {
          error: "INVALID_TAB",
          message: "Unknown tabId",
        });
        return;
      }
      tabId = tabIdArg;
    } else {
      const focused = getCurrentWindowLabel();
      const active = tabState.activeTabId[focused];
      if (!active) {
        await structuredError(id, {
          error: "INVALID_TAB",
          message: "No focused tab",
        });
        return;
      }
      tabId = active;
    }
    const doc = docState.documents[tabId];
    if (!doc) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "No document for tab",
      });
      return;
    }
    await writeTextFile(filePath, doc.content);
    tabState.updateTabPath(tabId, filePath);
    tabState.updateTabTitle(tabId, getFileName(filePath) || "Untitled");
    docState.setFilePath(tabId, filePath);
    docState.markSaved(tabId, doc.content);
    const revision = useRevisionStore.getState().getRevision();
    await respond({ id, success: true, data: { revision } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle `vmark.workspace.close`.
 *
 * Args: `{tabId, force?: boolean}`. When the tab is dirty and `force`
 * is not true, we refuse the close with `{closed: false, reason: "DIRTY"}`
 * so the AI can decide whether to save first or force.
 */
export async function handleWorkspaceClose(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const tabIdArg = args.tabId;
    if (typeof tabIdArg !== "string") {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId is required",
      });
      return;
    }
    const force = args.force === true;
    const tabState = useTabStore.getState();
    const docState = useDocumentStore.getState();

    const owner = Object.entries(tabState.tabs).find(([, list]) =>
      list.some((t) => t.id === tabIdArg),
    );
    if (!owner) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "Unknown tabId",
      });
      return;
    }
    const windowLabel = owner[0];
    const doc = docState.documents[tabIdArg];
    if (doc?.isDirty && !force) {
      await respond({
        id,
        success: true,
        data: { closed: false, reason: "DIRTY" },
      });
      return;
    }
    tabState.closeTab(windowLabel, tabIdArg);
    await respond({ id, success: true, data: { closed: true } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle `vmark.workspace.switch_tab`. Args: `{tabId: string}`.
 */
export async function handleWorkspaceSwitchTab(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const tabIdArg = args.tabId;
    if (typeof tabIdArg !== "string") {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId is required",
      });
      return;
    }
    const tabState = useTabStore.getState();
    const owner = Object.entries(tabState.tabs).find(([, list]) =>
      list.some((t) => t.id === tabIdArg),
    );
    if (!owner) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "Unknown tabId",
      });
      return;
    }
    tabState.setActiveTab(owner[0], tabIdArg);
    await respond({ id, success: true, data: {} });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle `vmark.workspace.focus_window`. Args: `{windowLabel: string}`.
 */
export async function handleWorkspaceFocusWindow(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const windowLabel = args.windowLabel;
    if (typeof windowLabel !== "string") {
      await structuredError(id, {
        error: "INTERNAL",
        message: "windowLabel is required",
      });
      return;
    }
    // Tauri's window-focus API is async and lives on the `Window`
    // object — request a focus via the existing webview helper.
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    try {
      await getCurrentWindow().setFocus();
    } catch {
      // Best-effort. Some platforms reject focus changes from non-user
      // gestures; we surface success regardless because the alternative
      // is an unhelpful error to the AI.
    }
    await respond({ id, success: true, data: {} });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
