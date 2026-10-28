/**
 * Purpose: `vmark.workspace.*` handlers — file and window lifecycle.
 *
 *   Covers `new`, `open`, `save`, `save_as`, `close`, `switch_tab`, and
 *   `focus_window`. All operate at the file/window boundary; nothing
 *   in-document. The pruned MCP surface relies on these for everything
 *   the AI cannot derive from text round-trip alone.
 *
 * Origin: MCP pruning plan (retired).
 *
 * Key decisions:
 *   - `tabId`-based addressing, not `windowId` + "active tab" implicit.
 *     The session.get_state response gives the AI an explicit `tabId`
 *     for every tab; addressing through that is unambiguous. `close` and
 *     `switch_tab` change what the user sees, so they REQUIRE the id and
 *     never fall back to the focused tab (`resolveOwnedTab`).
 *   - `close` requires `force: true` to discard local content, the same two
 *     kinds every human close asks about: a dirty document answers
 *     `{closed: false, reason: "DIRTY"}`, and a clean but DIVERGENT one —
 *     content the user kept over an external change — answers
 *     `{closed: false, reason: "DIVERGENT"}`. The AI must opt into
 *     destruction (or save, which clears both). The mounted editors are
 *     flushed first: typing that has not reached the store yet is unsaved
 *     work like any other.
 *   - `close` reports the tab store's verdict, not the request: a pinned tab
 *     the store refuses to close answers `{closed: false, reason: "PINNED"}`.
 *   - `close` refuses a browser tab. Those are closed through the browser
 *     surface, which never closes a tab the user opened and waits for the
 *     page to be torn down; closing one here went around both.
 *   - `new` and `open` accept an optional `windowLabel` so a
 *     multi-window workflow can target a specific window; default is
 *     focused.
 *   - `switch_tab` reports the state it can OBSERVE, never the state it
 *     intended (#1208). Both the activation and the workspace switch are
 *     re-read from the stores before the response is built, so a silently
 *     declined switch cannot be reported as a successful one.
 *   - `open` never reloads a tab that holds local content — see
 *     `workspaceOpen.ts`.
 *
 * @coordinates-with stores/tabStore.ts — createTab, closeTab, setActiveTab
 * @coordinates-with stores/documentStore.ts — initDocument, the dirty flag
 * @coordinates-with tabGuard.ts — structuredError (the document guard is not used: these act on tabs)
 * @coordinates-with liveEditor.ts — the flush before `close` reads the dirty flag
 * @coordinates-with readOperationArgs.ts — the one payload parse
 * @coordinates-with workspaceSave.ts — the extracted `save` handler (re-exported here)
 * @coordinates-with services/persistence/workspaceStorage.ts — getCurrentWindowLabel
 * @module services/mcpBridge/v2/workspace
 */

import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab, type Tab } from "@/stores/tabStoreTypes";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { respond } from "@/services/mcpBridge/utils";
import { activateTabWithWorkspaceContext } from "@/services/workspaces/activateTabWithWorkspaceContext";
import { wrapHandler } from "./wrapHandler";
import { flushLiveEditors } from "./liveEditor";
import { readOperationArgs } from "./readOperationArgs";
import { structuredError } from "./tabGuard";
import type { V2Error } from "./types";

export { handleWorkspaceSaveAs } from "./workspaceSaveAs";
export { handleWorkspaceOpen } from "./workspaceOpen";

/** A tab a request named, and the window that holds it. */
interface OwnedTab {
  windowLabel: string;
  tab: Tab;
}

/**
 * Find the tab a request names and the window holding it, or the refusal
 * saying why not.
 *
 * Any tab resolves — a browser tab has no document, and `switch_tab` may
 * activate one — which is why this is not the document guard. Synchronous, so
 * a caller can act on the tab before anything else can remove it.
 */
function resolveOwnedTab(tabId: string | undefined): OwnedTab | V2Error {
  if (tabId === undefined) return { error: "INVALID_TAB", message: "tabId is required" };
  for (const [windowLabel, list] of Object.entries(useTabStore.getState().tabs)) {
    const tab = list.find((t) => t.id === tabId);
    if (tab) return { windowLabel, tab };
  }
  return { error: "INVALID_TAB", message: "Unknown tabId" };
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
    const wire = readOperationArgs("vmark.workspace.new", args);
    const windowLabel = wire.windowLabel || getCurrentWindowLabel();
    const tabId = useTabStore.getState().createTab(windowLabel, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    await respond({ id, success: true, data: { tabId } });
  });
}

export { handleWorkspaceSave } from "./workspaceSave";

/**
 * Handle `vmark.workspace.close`.
 *
 * Args: `{tabId, force?: boolean}`. When the tab holds local content and
 * `force` is not true, we refuse the close with `{closed: false, reason}` —
 * `"DIRTY"` for unsaved changes, `"DIVERGENT"` for a clean document the user
 * kept over an external change — so the AI can decide whether to save first
 * or force. A pinned tab is never closed, `force` or not: the reply is
 * `{closed: false, reason: "PINNED"}`. A browser tab is refused with
 * `INVALID_TAB`. A tab that does close takes
 * its document with it (the tab store's removal announcement frees per-tab
 * state).
 */
export async function handleWorkspaceClose(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.workspace.close", args);
    const owned = resolveOwnedTab(wire.tabId);
    if ("error" in owned) {
      await structuredError(id, owned);
      return;
    }
    const { windowLabel, tab } = owned;
    if (isBrowserTab(tab)) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId names a browser tab; close it with the browser tool's close action",
      });
      return;
    }
    // Keystrokes the editor has not handed to the store yet are unsaved work:
    // without them the tab reads as clean and the close would drop them.
    flushLiveEditors(tab.id);
    const doc = useDocumentStore.getState().documents[tab.id];
    const localContent = doc?.isDirty ? "DIRTY" : doc?.isDivergent ? "DIVERGENT" : null;
    if (localContent && wire.force !== true) {
      await respond({
        id,
        success: true,
        data: { closed: false, reason: localContent },
      });
      return;
    }
    // Report what the store DID. The tab was resolved above with no await in
    // between, so the one way `closeTab` removes nothing here is its refusal to
    // close a pinned tab — and a tab still open is not `closed: true`.
    const closed = useTabStore.getState().closeTab(windowLabel, tab.id);
    await respond({
      id,
      success: true,
      data: closed ? { closed: true } : { closed: false, reason: "PINNED" },
    });
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
    const wire = readOperationArgs("vmark.workspace.switch_tab", args);
    const owned = resolveOwnedTab(wire.tabId);
    if ("error" in owned) {
      await structuredError(id, owned);
      return;
    }
    const { windowLabel } = owned;
    const tabId = owned.tab.id;
    // The ONE MCP action allowed to change the visible
    // context — full workspace switch when the tab's owner is hidden, with
    // the change disclosed so the AI client can inform the user.
    const result = activateTabWithWorkspaceContext(windowLabel, tabId);
    // #1208: report what the stores SAY, not what the coordinator intended. A
    // silently-declined activation used to be indistinguishable from a real
    // one, which is how a client could be told the tab was showing while the
    // window had not moved. `workspaceSwitched` is likewise downgraded when the
    // window is not actually showing the instance the coordinator named.
    //
    // Reading `activated` off the alias is safe under a split: the
    // activation seam converges `activeTabId` with the focused pane, and
    // `activateTabWithWorkspaceContext.test.ts` pins that for the background,
    // other-pane and browser-tab cases. If that invariant is ever relaxed, this
    // check turns into a false negative and must move to the pane state.
    const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    const activeInstanceId =
      useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
    const switchLanded =
      result.workspaceSwitched && activeInstanceId === result.workspaceInstanceId;
    await respond({
      id,
      success: true,
      data: {
        activated: result.activated && activeTabId === tabId,
        workspaceSwitched: switchLanded,
        workspaceInstanceId: activeInstanceId,
        activeTabId,
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
    const { windowLabel } = readOperationArgs("vmark.workspace.focus_window", args);
    if (windowLabel === undefined) {
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
