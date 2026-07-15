/**
 * tabTransferActions
 *
 * Purpose: Cross-window tab transfer logic — moves a tab (with its document
 * content) to an existing window or detaches it into a new window via Tauri IPC.
 *
 * Key decisions:
 *   - transferTabFromDragOut first asks Rust to find a drop target window
 *     at the pointer's screen coordinates; if none, it creates a new window.
 *   - Both paths show an undo toast that calls restoreTransferredTab to
 *     reverse the transfer, preventing accidental data loss.
 *   - Undo is a prepare/commit round trip with the destination window, so it
 *     restores what the user actually has there — not the pre-transfer
 *     snapshot — and fails safely (destination keeps its tab) if the
 *     destination cannot be reached.
 *   - The last tab in the main window cannot be moved out — enforced here
 *     with an early snapback + ARIA announcement.
 *   - After transfer, if the source window has no remaining tabs (and is
 *     not main), it auto-closes to avoid an empty shell.
 *
 * @coordinates-with useStatusBarTabDrag.ts — calls transferTabFromDragOut on drag-out
 * @coordinates-with useTabContextMenuActions.ts — "Move to New Window" uses similar logic
 * @coordinates-with WindowContext.tsx — receiving window applies transferred tab data
 * @coordinates-with tabCleanup.ts — cleanupTabState used on detach to free all per-tab state
 * @module components/StatusBar/tabTransferActions
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { DragOutPoint } from "@/hooks/useTabDragOut";
import type { TabRemovalAck, TabTransferPayload } from "@/types/tabTransfer";
import { windowCloseWarn, tabContextError } from "@/utils/debug";
import { cleanupTabState } from "@/hooks/tabCleanup";
import i18n from "@/i18n";
import { errorMessage } from "@/utils/errorMessage";

interface DragOutTransferOptions {
  tabId: string;
  point: DragOutPoint;
  windowLabel: string;
  triggerSnapback: (tabId: string) => void;
  announce: (message: string) => void;
}

/** Show the post-transfer toast with its Undo action. Both transfer paths
 *  (existing window / new window) differ only in their labels, so the toast,
 *  the undo call and its failure handling live here once. */
function showTransferToast(options: {
  sourceWindowLabel: string;
  targetWindowLabel: string;
  transferData: TabTransferPayload;
  message: string;
  undoErrorLog: string;
}): void {
  const { sourceWindowLabel, targetWindowLabel, transferData, message, undoErrorLog } = options;
  toast.message(message, {
    action: {
      label: i18n.t("dialog:common.undo"),
      onClick: () => {
        void restoreTransferredTab(sourceWindowLabel, targetWindowLabel, transferData).catch(
          (error) => {
            tabContextError(undoErrorLog, error);
            toast.error(i18n.t("dialog:toast.tabUndoFailed"));
          },
        );
      },
    },
  });
}

/**
 * Undo a tab transfer: take the tab back from the window it was moved to.
 *
 * This is a round trip, not a rewind. `transferData` is only used to identify
 * the tab — its content is a snapshot from the moment of the move, and the user
 * may have typed in the destination window since. Restoring that snapshot would
 * silently destroy those edits, so we ask the destination for its CURRENT state
 * (`prepare`), restore from that, and only then tell it to drop its copy
 * (`commit`).
 *
 * Throws if the destination is unreachable or refuses. In that case nothing has
 * been removed and nothing is restored: the tab stays where it is, intact. A
 * failed undo is recoverable; a destroyed document is not.
 */
export async function restoreTransferredTab(
  sourceWindowLabel: string,
  targetWindowLabel: string,
  transferData: TabTransferPayload
): Promise<void> {
  // Phase 1 — ask; destroys nothing. Rejects on unreachable / timed-out window.
  const prepared = await invoke<TabRemovalAck>("remove_tab_from_window", {
    targetWindowLabel,
    tabId: transferData.tabId,
    phase: "prepare",
  });
  if (!prepared?.accepted || !prepared.data) {
    throw new Error(
      `Window '${targetWindowLabel}' refused to release tab '${transferData.tabId}': ${prepared?.reason ?? "no live tab state returned"}`
    );
  }

  // Phase 2 — restore the destination's LIVE state (not our stale snapshot).
  const live = prepared.data;
  const restoredTabId = useTabStore.getState().createTransferredTab(sourceWindowLabel, {
    id: live.tabId,
    filePath: live.filePath,
    title: live.title,
    isPinned: false,
  });
  useDocumentStore.getState().initDocument(
    restoredTabId,
    live.content,
    live.filePath,
    live.savedContent
  );

  // Phase 3 — now that the tab is safe here, let the destination drop it. If
  // this leg fails the tab exists in both windows: a visible duplicate the user
  // can close, which is strictly better than a hole where their edits were.
  try {
    await invoke("remove_tab_from_window", {
      targetWindowLabel,
      tabId: transferData.tabId,
      phase: "commit",
    });
  } catch (error) {
    tabContextError("Tab restored, but the destination copy could not be removed:", error);
  }
}

/** Transfer a tab to another window (or detach to a new one) after a drag-out gesture. */
export async function transferTabFromDragOut({
  tabId,
  point,
  windowLabel,
  triggerSnapback,
  announce,
}: DragOutTransferOptions): Promise<void> {
  const tabState = useTabStore.getState();
  const windowTabs = tabState.getTabsByWindow(windowLabel);
  const tab = windowTabs.find((entry) => entry.id === tabId);
  if (!tab) return;

  // R1: browser tabs do not participate in window transfer/detach — the
  // transfer payload requires document content, saved content, dirty state and
  // formatId a browser tab has none of. Explicit, user-visible no-op.
  if (tab.kind !== "document") {
    triggerSnapback(tabId);
    announce(i18n.t("dialog:toast.cannotMoveBrowserTab"));
    return;
  }

  if (windowLabel === "main" && windowTabs.length <= 1) {
    triggerSnapback(tabId);
    announce(i18n.t("dialog:toast.cannotMoveLastTab"));
    return;
  }

  // No document behind the tab → nothing to transfer. Snap back and say so,
  // instead of swallowing the gesture (matches the context-menu "Move to New
  // Window" path, which toasts cannotMoveTabNoDoc).
  const doc = useDocumentStore.getState().getDocument(tabId);
  if (!doc) {
    triggerSnapback(tabId);
    announce(i18n.t("dialog:toast.cannotMoveTabNoDoc"));
    return;
  }

  const transferData: TabTransferPayload = {
    tabId: tab.id,
    title: tab.title,
    filePath: tab.filePath ?? null,
    content: doc.content,
    savedContent: doc.savedContent,
    isDirty: doc.isDirty,
    workspaceRoot: useWorkspaceStore.getState().rootPath ?? null,
  };

  try {
    const targetWindowLabel = await invoke<string | null>("find_drop_target_window", {
      sourceWindowLabel: windowLabel,
      screenX: point.screenX,
      screenY: point.screenY,
    });

    if (targetWindowLabel) {
      await invoke("transfer_tab_to_existing_window", {
        targetWindowLabel,
        data: transferData,
      });
      showTransferToast({
        sourceWindowLabel: windowLabel,
        targetWindowLabel,
        transferData,
        message: i18n.t("dialog:toast.tabMovedToWindow", { title: tab.title }),
        undoErrorLog: "Undo cross-window move failed:",
      });
      announce(i18n.t("dialog:toast.tabMovedAnnounce", { title: tab.title }));
    } else {
      const createdWindowLabel = await invoke<string>("detach_tab_to_new_window", {
        data: transferData,
      });
      showTransferToast({
        sourceWindowLabel: windowLabel,
        targetWindowLabel: createdWindowLabel,
        transferData,
        message: i18n.t("dialog:toast.tabDetached", { title: tab.title }),
        undoErrorLog: "Undo detach failed:",
      });
      announce(i18n.t("dialog:toast.tabDetachedAnnounce", { title: tab.title }));
    }

    tabState.detachTab(windowLabel, tabId);
    cleanupTabState(tabId);

    const remaining = useTabStore.getState().getTabsByWindow(windowLabel);
    if (remaining.length === 0 && windowLabel !== "main") {
      const win = getCurrentWebviewWindow();
      invoke("close_window", { label: win.label }).catch((error: unknown) => {
        windowCloseWarn("Failed to close window:", errorMessage(error));
      });
    }
  } catch (error) {
    tabContextError("drag-out failed:", error);
    triggerSnapback(tabId);
    announce(i18n.t("dialog:toast.failedToMoveTabToNewWindow"));
  }
}
