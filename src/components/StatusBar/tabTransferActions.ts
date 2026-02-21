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
 *   - The last tab in the main window cannot be moved out — enforced here
 *     with an early snapback + ARIA announcement.
 *   - After transfer, if the source window has no remaining tabs (and is
 *     not main), it auto-closes to avoid an empty shell.
 *
 * @coordinates-with useStatusBarTabDrag.ts — calls transferTabFromDragOut on drag-out
 * @coordinates-with useTabContextMenuActions.ts — "Move to New Window" uses similar logic
 * @coordinates-with WindowContext.tsx — receiving window applies transferred tab data
 * @module components/StatusBar/tabTransferActions
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { DragOutPoint } from "@/hooks/useTabDragOut";
import type { TabTransferPayload } from "@/types/tabTransfer";
import { windowCloseWarn } from "@/utils/debug";

interface DragOutTransferOptions {
  tabId: string;
  point: DragOutPoint;
  windowLabel: string;
  triggerSnapback: (tabId: string) => void;
  announce: (message: string) => void;
}

export async function restoreTransferredTab(
  sourceWindowLabel: string,
  targetWindowLabel: string,
  transferData: TabTransferPayload
): Promise<void> {
  await invoke("remove_tab_from_window", {
    targetWindowLabel,
    tabId: transferData.tabId,
  });

  const restoredTabId = useTabStore.getState().createTransferredTab(sourceWindowLabel, {
    id: transferData.tabId,
    filePath: transferData.filePath,
    title: transferData.title,
    isPinned: false,
  });

  useDocumentStore.getState().initDocument(
    restoredTabId,
    transferData.content,
    transferData.filePath,
    transferData.savedContent
  );
}

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

  if (windowLabel === "main" && windowTabs.length <= 1) {
    triggerSnapback(tabId);
    announce("Cannot move the last tab in the main window.");
    return;
  }

  const doc = useDocumentStore.getState().getDocument(tabId);
  if (!doc) return;

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
      toast.message(`Moved "${tab.title}"`, {
        action: {
          label: "Undo",
          onClick: () => {
            void restoreTransferredTab(windowLabel, targetWindowLabel, transferData).catch((error) => {
              console.error("[StatusBar] Undo cross-window move failed:", error);
            });
          },
        },
      });
      announce(`Moved tab ${tab.title} to another window.`);
    } else {
      const createdWindowLabel = await invoke<string>("detach_tab_to_new_window", {
        data: transferData,
      });
      toast.message(`Detached "${tab.title}"`, {
        action: {
          label: "Undo",
          onClick: () => {
            void restoreTransferredTab(windowLabel, createdWindowLabel, transferData).catch((error) => {
              console.error("[StatusBar] Undo detach failed:", error);
            });
          },
        },
      });
      announce(`Detached tab ${tab.title} into a new window.`);
    }

    tabState.detachTab(windowLabel, tabId);
    useDocumentStore.getState().removeDocument(tabId);

    const remaining = useTabStore.getState().getTabsByWindow(windowLabel);
    if (remaining.length === 0 && windowLabel !== "main") {
      const win = getCurrentWebviewWindow();
      invoke("close_window", { label: win.label }).catch((error: unknown) => {
        windowCloseWarn("Failed to close window:", error instanceof Error ? error.message : String(error));
      });
    }
  } catch (error) {
    console.error("[StatusBar] drag-out failed:", error);
    triggerSnapback(tabId);
    announce(`Failed to move tab ${tab.title}.`);
  }
}
