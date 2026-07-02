/**
 * useTabContextMenuActions
 *
 * Builds the tab context-menu items with state-driven availability and
 * getState()-based actions (each calls onClose()): Move-to-New-Window needs a
 * doc; Copy Relative Path needs a workspace file; Rename needs a saved file.
 *
 * @coordinates-with TabContextMenu.tsx, tabTransferActions.ts, tabCleanup.ts
 * @module components/Tabs/useTabContextMenuActions
 */
import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useDocumentStore, type DocumentState } from "@/stores/documentStore";
import { useTabRenameStore } from "@/stores/tabRenameStore";
import { closeTabWithDirtyCheck, closeTabsWithDirtyCheck } from "@/hooks/useTabOperations";
import { saveToPath } from "@/services/persistence/saveToPath";
import { reloadTabFromDisk } from "@/services/persistence/reloadFromDisk";
import { getRelativePath, isWithinRoot } from "@/utils/paths";
import { restoreTransferredTab } from "@/components/StatusBar/tabTransferActions";
import type { TabTransferPayload } from "@/types/tabTransfer";
import { windowCloseWarn, tabContextError } from "@/utils/debug";
import { cleanupTabState } from "@/hooks/tabCleanup";
import i18n from "@/i18n";
import { errorMessage } from "@/utils/errorMessage";

/** Definition for a single item in the tab context menu. */
export interface TabMenuItem {
  id: string;
  label: string;
  action: () => void | Promise<void>;
  disabled?: boolean;
  separator?: boolean;
  shortcut?: string;
}

interface UseTabContextMenuActionsOptions {
  tab: Tab;
  tabs: Tab[];
  doc?: DocumentState;
  filePath: string | null;
  windowLabel: string;
  workspaceRoot: string | null;
  revealLabel: string;
  closeShortcutLabel: string;
  onClose: () => void;
}

/** Hook that builds context menu items for a tab with enable/disable logic and action callbacks. */
export function useTabContextMenuActions({
  tab,
  tabs,
  doc,
  filePath,
  windowLabel,
  workspaceRoot,
  revealLabel,
  closeShortcutLabel,
  onClose,
}: UseTabContextMenuActionsOptions): TabMenuItem[] {
  const tabIndex = tabs.findIndex((entry) => entry.id === tab.id);
  const hasTabsToRight = tabs.slice(tabIndex + 1).some((entry) => !entry.isPinned);
  const hasOtherTabs = tabs.some((entry) => entry.id !== tab.id && !entry.isPinned);
  const hasUnpinnedTabs = tabs.some((entry) => !entry.isPinned);
  const canMoveToNewWindow = Boolean(doc) && !(windowLabel === "main" && tabs.length <= 1);
  const canCopyRelativePath = Boolean(
    filePath
      && workspaceRoot
      && isWithinRoot(workspaceRoot, filePath)
      && getRelativePath(workspaceRoot, filePath)
  );

  const handleClose = useCallback(async () => {
    await closeTabWithDirtyCheck(windowLabel, tab.id);
    onClose();
  }, [onClose, tab.id, windowLabel]);

  const handleCloseOthers = useCallback(async () => {
    const tabIds = tabs.filter((entry) => entry.id !== tab.id && !entry.isPinned).map((entry) => entry.id);
    await closeTabsWithDirtyCheck(windowLabel, tabIds);
    onClose();
  }, [onClose, tab.id, tabs, windowLabel]);

  const handleCloseToRight = useCallback(async () => {
    const tabIds = tabs
      .filter((entry, index) => index > tabIndex && !entry.isPinned)
      .map((entry) => entry.id);
    await closeTabsWithDirtyCheck(windowLabel, tabIds);
    onClose();
  }, [onClose, tabIndex, tabs, windowLabel]);

  const handleCloseAllUnpinned = useCallback(async () => {
    const tabIds = tabs.filter((entry) => !entry.isPinned).map((entry) => entry.id);
    await closeTabsWithDirtyCheck(windowLabel, tabIds);
    onClose();
  }, [onClose, tabs, windowLabel]);

  const handlePin = useCallback(() => {
    useTabStore.getState().togglePin(windowLabel, tab.id);
    onClose();
  }, [onClose, tab.id, windowLabel]);

  const handleRename = useCallback(() => {
    useTabRenameStore.getState().startRename(tab.id); // inline edit in the Tab pill
    onClose();
  }, [onClose, tab.id]);

  const handleMoveToNewWindow = useCallback(async () => {
    if (!doc) {
      toast.error(i18n.t("dialog:toast.cannotMoveTabNoDoc"));
      onClose();
      return;
    }

    if (windowLabel === "main" && tabs.length <= 1) {
      toast.error(i18n.t("dialog:toast.cannotMoveLastTab"));
      onClose();
      return;
    }

    const transferData: TabTransferPayload = {
      tabId: tab.id,
      title: tab.title,
      filePath,
      content: doc.content,
      savedContent: doc.savedContent,
      isDirty: doc.isDirty,
      workspaceRoot: workspaceRoot ?? null,
    };

    try {
      const createdWindowLabel = await invoke<string>("detach_tab_to_new_window", { data: transferData });
      useTabStore.getState().detachTab(windowLabel, tab.id);
      cleanupTabState(tab.id);

      toast.message(i18n.t("dialog:toast.tabMoved", { title: tab.title }), {
        action: {
          label: i18n.t("dialog:common.undo"),
          onClick: () => {
            void restoreTransferredTab(windowLabel, createdWindowLabel, transferData).catch((error) => {
              tabContextError(" Undo move-to-new-window failed:", error);
              toast.error(i18n.t("dialog:toast.undoTabMoveFailed"));
            });
          },
        },
      });

      const remaining = useTabStore.getState().getTabsByWindow(windowLabel);
      if (remaining.length === 0 && windowLabel !== "main") {
        const win = getCurrentWebviewWindow();
        void invoke("close_window", { label: win.label }).catch((error: unknown) => {
          windowCloseWarn("Failed to close window:", errorMessage(error));
        });
      }
    } catch (error) {
      tabContextError(" Move to new window failed:", error);
      toast.error(i18n.t("dialog:toast.failedToMoveTabToNewWindow"));
    } finally {
      onClose();
    }
  }, [doc, filePath, onClose, tab.id, tab.title, tabs.length, windowLabel, workspaceRoot]);

  const handleRestoreToDisk = useCallback(async () => {
    /* v8 ignore next -- @preserve defensive guard; item only appears when filePath and doc are both present */
    if (!filePath || !doc) return;
    const saved = await saveToPath(tab.id, filePath, doc.content, "manual");
    if (saved) {
      useDocumentStore.getState().clearMissing(tab.id);
      toast.success(i18n.t("dialog:toast.fileRestoredToDisk"));
    } else {
      toast.error(i18n.t("dialog:toast.failedToRestoreToDisk"));
    }
    onClose();
  }, [doc, filePath, onClose, tab.id]);

  const handleRevertToSaved = useCallback(async () => {
    /* v8 ignore next -- @preserve defensive guard; item only appears when filePath and doc are both present */
    if (!filePath || !doc) { onClose(); return; }
    const confirmed = await ask(
      i18n.t("dialog:revertToSaved.message", { title: tab.title }),
      { title: i18n.t("dialog:revertToSaved.title"), kind: "warning" }
    );
    if (!confirmed) { onClose(); return; }
    try {
      await reloadTabFromDisk(tab.id, filePath);
      toast.success(i18n.t("dialog:toast.revertedToSaved"));
    } catch {
      toast.error(i18n.t("dialog:toast.failedToRevert"));
    }
    onClose();
  }, [doc, filePath, onClose, tab.id, tab.title]);

  const handleCloseAll = useCallback(async () => {
    const allTabIds = tabs.map((entry) => entry.id);
    await closeTabsWithDirtyCheck(windowLabel, allTabIds);
    onClose();
  }, [onClose, tabs, windowLabel]);

  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    try {
      await writeText(filePath);
      toast.success(i18n.t("dialog:toast.pathCopied"));
    } catch (error) {
      tabContextError(" Failed to copy path:", error);
      toast.error(i18n.t("dialog:toast.failedToCopyPath"));
    }
    onClose();
  }, [filePath, onClose]);

  const handleCopyRelativePath = useCallback(async () => {
    /* v8 ignore next -- @preserve defensive guard; item only appears when filePath, workspaceRoot, and isWithinRoot are all truthy */
    if (!filePath || !workspaceRoot || !isWithinRoot(workspaceRoot, filePath)) return;
    const relativePath = getRelativePath(workspaceRoot, filePath);
    if (!relativePath) return;

    try {
      await writeText(relativePath);
      toast.success(i18n.t("dialog:toast.relativePathCopied"));
    } catch (error) {
      tabContextError(" Failed to copy relative path:", error);
      toast.error(i18n.t("dialog:toast.failedToCopyRelativePath"));
    }
    onClose();
  }, [filePath, onClose, workspaceRoot]);

  const handleRevealInFileManager = useCallback(async () => {
    if (!filePath) return;
    try {
      await revealItemInDir(filePath);
    } catch (error) {
      tabContextError(" Failed to reveal file:", error);
      toast.error(i18n.t("dialog:toast.failedToRevealInFileManager"));
    }
    onClose();
  }, [filePath, onClose]);

  return useMemo(() => [
    {
      id: "moveToNewWindow",
      label: i18n.t("tabMenu.moveToNewWindow"),
      action: handleMoveToNewWindow,
      disabled: !canMoveToNewWindow,
    },
    {
      id: "pin",
      label: tab.isPinned ? i18n.t("tabMenu.unpin") : i18n.t("tabMenu.pin"),
      action: handlePin,
    },
    {
      id: "rename",
      label: i18n.t("tabMenu.rename"),
      action: handleRename,
      disabled: !filePath,
    },
    {
      id: "copyPath",
      label: i18n.t("tabMenu.copyPath"),
      action: handleCopyPath,
      disabled: !filePath,
    },
    {
      id: "copyRelativePath",
      label: i18n.t("tabMenu.copyRelativePath"),
      action: handleCopyRelativePath,
      disabled: !canCopyRelativePath,
    },
    {
      id: "reveal",
      label: revealLabel,
      action: handleRevealInFileManager,
      disabled: !filePath,
    },
    ...(doc?.isMissing && filePath
      ? [{
          id: "restoreToDisk",
          label: i18n.t("tabMenu.restoreToDisk"),
          action: handleRestoreToDisk,
        } satisfies TabMenuItem]
      : []),
    ...(doc?.isDirty && filePath && !doc?.isMissing
      ? [{
          id: "revertToSaved",
          label: i18n.t("tabMenu.revertToSaved"),
          action: handleRevertToSaved,
        } satisfies TabMenuItem]
      : []),
    { id: "separator-1", label: "", action: () => {}, separator: true },
    {
      id: "close",
      label: i18n.t("tabMenu.close"),
      action: handleClose,
      disabled: tab.isPinned,
      shortcut: closeShortcutLabel,
    },
    {
      id: "closeOthers",
      label: i18n.t("tabMenu.closeOthers"),
      action: handleCloseOthers,
      disabled: !hasOtherTabs,
    },
    {
      id: "closeRight",
      label: i18n.t("tabMenu.closeTabsRight"),
      action: handleCloseToRight,
      disabled: !hasTabsToRight,
    },
    {
      id: "closeAllUnpinned",
      label: i18n.t("tabMenu.closeUnpinned"),
      action: handleCloseAllUnpinned,
      disabled: !hasUnpinnedTabs,
    },
    {
      id: "closeAll",
      label: i18n.t("tabMenu.closeAll"),
      action: handleCloseAll,
    },
  ], [
    canCopyRelativePath,
    canMoveToNewWindow,
    closeShortcutLabel,
    doc?.isDirty,
    doc?.isMissing,
    filePath,
    handleClose,
    handleCloseAll,
    handleCloseAllUnpinned,
    handleCloseOthers,
    handleCloseToRight,
    handleCopyPath,
    handleCopyRelativePath,
    handleMoveToNewWindow,
    handlePin,
    handleRename,
    handleRestoreToDisk,
    handleRevertToSaved,
    handleRevealInFileManager,
    hasOtherTabs,
    hasTabsToRight,
    hasUnpinnedTabs,
    revealLabel,
    tab.isPinned,
  ]);
}
