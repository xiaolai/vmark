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
 *   - `open` never reloads a tab that holds local content. `createTab`
 *     dedupes by path, so re-opening an already-open file returns the
 *     EXISTING tab; re-initialising it there discarded unsaved edits. Both
 *     `isDirty` and `isDivergent` count as local content — divergent is
 *     clean but deliberately kept after "Keep my changes". A clean reload
 *     goes through `loadContent` (mutates in place, keeps `readOnly`,
 *     increments `documentId`) plus `clearMissing`, not `initDocument`
 *     (audit 20260728 §1.3).
 *
 * @coordinates-with stores/tabStore.ts — createTab, closeTab, setActiveTab
 * @coordinates-with stores/documentStore.ts — initDocument, markSaved
 * @coordinates-with workspaceSave.ts — the extracted `save` handler (re-exported here)
 * @coordinates-with services/persistence/workspaceStorage.ts — getCurrentWindowLabel
 * @module services/mcpBridge/v2/workspace
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { respond } from "@/services/mcpBridge/utils";
import { activateTabWithWorkspaceContext } from "@/services/workspaces/activateTabWithWorkspaceContext";
import { wrapHandler } from "./wrapHandler";
import { v2ErrorString } from "./types";
import type { V2Error } from "./types";

export { handleWorkspaceSaveAs } from "./workspaceSaveAs";
export { handleWorkspaceOpen } from "./workspaceOpen";

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
  return wrapHandler(id, async () => {
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const windowLabel = getWindowLabel(args);
    const tabId = tabStore.createTab(windowLabel, null);
    docStore.initDocument(tabId, "", null);
    await respond({ id, success: true, data: { tabId } });
  });
}

export { handleWorkspaceSave } from "./workspaceSave";

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
  return wrapHandler(id, async () => {
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
  });
}

/**
 * Handle `vmark.workspace.switch_tab`. Args: `{tabId: string}`.
 */
export async function handleWorkspaceSwitchTab(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
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
    // WI-14 (plan D10): the ONE MCP action allowed to change the visible
    // context — full workspace switch when the tab's owner is hidden, with
    // the change disclosed so the AI client can inform the user.
    const result = activateTabWithWorkspaceContext(owner[0], tabIdArg);
    await respond({
      id,
      success: true,
      data: {
        activated: result.activated,
        workspaceSwitched: result.workspaceSwitched,
        workspaceInstanceId: result.workspaceInstanceId,
        activeTabId: useTabStore.getState().activeTabId[owner[0]] ?? null,
      },
    });
  });
}

/**
 * Handle `vmark.workspace.focus_window`. Args: `{windowLabel: string}`.
 */
export async function handleWorkspaceFocusWindow(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const windowLabel = args.windowLabel;
    if (typeof windowLabel !== "string") {
      await structuredError(id, {
        error: "INTERNAL",
        message: "windowLabel is required",
      });
      return;
    }
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const target = await WebviewWindow.getByLabel(windowLabel);
    if (!target) {
      await structuredError(id, {
        error: "INTERNAL",
        message: `Unknown windowLabel: ${windowLabel}`,
      });
      return;
    }
    try {
      await target.setFocus();
    } catch {
      // Some platforms reject focus changes from non-user gestures;
      // surface success regardless — the alternative is an unhelpful
      // error to the AI.
    }
    await respond({ id, success: true, data: {} });
  });
}
