/**
 * Move a tab out into a new window (#1081 detach flow).
 *
 * Extracted from `useTabContextMenuActions` in WI-DSPL1.5: that file sat
 * exactly on its 300-line-limit baseline, and this is the largest self-
 * contained block in it. It is also genuinely a service rather than a
 * callback — a multi-step transfer with an undo path and a
 * close-the-empty-window tail.
 *
 * The caller still owns dismissing the menu; this owns the transfer.
 *
 * @coordinates-with components/Tabs/useTabContextMenuActions.ts — the caller
 * @coordinates-with services/workspaces/workspace_transfer — the claim protocol
 * @module services/tabs/moveTabToNewWindow
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import i18n from "@/i18n";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useTabStore, type Tab } from "@/stores/tabStore";
import type { DocumentState } from "@/stores/documentStore";
import { cleanupTabState } from "@/services/windowClose/tabCleanup";
import { buildTransferDocumentFields } from "@/utils/transferLineMetadata";
import type { TabTransferPayload } from "@/types/tabTransfer";
import { commandErrorMessage } from "@/services/commands/commandError";
import { tabContextError, windowCloseWarn } from "@/utils/debug";

/**
 * Undo handler, supplied by the caller.
 *
 * `restoreTransferredTab` lives in `components/StatusBar/`, and a service
 * importing a component is an UPWARD dependency that dep-cruiser refuses
 * (`services-no-upward`). Moving that module here would only trade the
 * violation for another — it type-imports from `hooks/`. So the dependency is
 * inverted: this owns the transfer, the caller supplies the undo.
 */
type RestoreTransferredTab = (
  sourceWindowLabel: string,
  createdWindowLabel: string,
  data: TabTransferPayload,
) => Promise<void>;

export interface MoveTabArgs {
  tab: Tab;
  doc: DocumentState | undefined;
  filePath: string | null;
  tabs: Tab[];
  windowLabel: string;
  workspaceRoot: string | null | undefined;
  restoreTransferredTab: RestoreTransferredTab;
}

export async function moveTabToNewWindow({
  tab,
  doc,
  filePath,
  tabs,
  windowLabel,
  workspaceRoot,
  restoreTransferredTab,
}: MoveTabArgs): Promise<void> {
    if (!doc) {
      toast.error(i18n.t("dialog:toast.cannotMoveTabNoDoc"));
      return;
    }

    if (windowLabel === "main" && tabs.length <= 1) {
      toast.error(i18n.t("dialog:toast.cannotMoveLastTab"));
      return;
    }

    const transferData: TabTransferPayload = {
      tabId: tab.id,
      title: tab.title,
      filePath,
      workspaceRoot: workspaceRoot ?? null,
      ...buildTransferDocumentFields(doc),
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
          windowCloseWarn("Failed to close window:", commandErrorMessage(error));
        });
      }
    } catch (error) {
      tabContextError(" Move to new window failed:", error);
      toast.error(i18n.t("dialog:toast.failedToMoveTabToNewWindow"));
    }
}
