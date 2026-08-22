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
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { type DocumentState } from "@/stores/documentStore";
import { useTabRenameStore } from "@/stores/tabRenameStore";
import { closeTabWithDirtyCheck, closeTabsWithDirtyCheck } from "@/services/tabs/tabOperations";
import { closeOthersIds, closeToRightIds, closeAllUnpinnedIds } from "@/services/tabs/bulkCloseSelectors";
import { getRelativePath, isWithinRoot } from "@/utils/paths";
import { tabContextError } from "@/utils/debug";
import { restoreTransferredTab } from "@/components/StatusBar/tabTransferActions";
import { moveTabToNewWindow } from "@/services/tabs/moveTabToNewWindow";
import { openToTheSide, canOpenToTheSide } from "@/services/tabs/openToTheSide";
import { restoreTabToDisk, revertTabToSaved } from "@/services/tabs/tabDiskActions";
import i18n from "@/i18n";

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

  // One lifecycle, three selections — see services/tabs/bulkCloseSelectors.
  const closeMany = useCallback(
    async (ids: string[]) => {
      await closeTabsWithDirtyCheck(windowLabel, ids);
      onClose();
    },
    [onClose, windowLabel],
  );

  const handleCloseOthers = useCallback(() => closeMany(closeOthersIds(tabs, tab.id)), [closeMany, tab.id, tabs]);
  const handleCloseToRight = useCallback(() => closeMany(closeToRightIds(tabs, tabIndex)), [closeMany, tabIndex, tabs]);
  const handleCloseAllUnpinned = useCallback(() => closeMany(closeAllUnpinnedIds(tabs)), [closeMany, tabs]);

  const handlePin = useCallback(() => {
    useTabStore.getState().togglePin(windowLabel, tab.id);
    onClose();
  }, [onClose, tab.id, windowLabel]);

  const handleRename = useCallback(() => {
    useTabRenameStore.getState().startRename(tab.id); // inline edit in the Tab pill
    onClose();
  }, [onClose, tab.id]);

  const handleMoveToNewWindow = useCallback(async () => {
    // Body extracted to services/tabs/moveTabToNewWindow.ts in WI-DSPL1.5:
    // this file sat exactly on its 300-line-limit baseline (349), so the
    // "Open to the Side" item had nowhere to go. Detaching a tab is a
    // multi-step transfer with its own rollback — a service, not a callback.
    await moveTabToNewWindow({ tab, doc, filePath, tabs, windowLabel, workspaceRoot, restoreTransferredTab });
    onClose();
  }, [doc, filePath, onClose, tab, tabs, windowLabel, workspaceRoot]);

  const handleRestoreToDisk = useCallback(async () => {
    await restoreTabToDisk(tab.id, filePath, doc);
    onClose();
  }, [doc, filePath, onClose, tab.id]);

  const handleRevertToSaved = useCallback(async () => {
    await revertTabToSaved(tab.id, tab.title, filePath, doc);
    onClose();
  }, [doc, filePath, onClose, tab.id, tab.title]);

  // SUBSCRIBE to the active tab: `canOpenToTheSide` depends on it, and a native
  // menu or shortcut can change it while this menu is open — an imperative read
  // left the row's disabled state stale.
  useTabStore((state) => state.activeTabId[windowLabel] ?? null);
  const canOpenToSide = canOpenToTheSide(windowLabel, tab.id);

  const handleOpenToTheSide = useCallback(() => {
    openToTheSide(windowLabel, tab.id);
    onClose();
  }, [onClose, tab.id, windowLabel]);

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

  return useMemo<TabMenuItem[]>(() => [
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
    // Omitted entirely for a browser tab (WI-DSPL1.5): panes hold documents, so
    // a permanently-disabled row on every browser tab is noise, not affordance.
    ...(tab.kind === "document"
      ? [
          {
            id: "open-to-side",
            label: i18n.t("tabMenu.openToSide"),
            action: handleOpenToTheSide,
            disabled: !canOpenToSide,
          },
        ]
      : []),
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
    handleOpenToTheSide,
    canOpenToSide,
    tab.kind,
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
