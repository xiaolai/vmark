import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";

/** Pure check — testable without side effects. */
export function canOpenTerminal(): boolean {
  if (useWorkspaceStore.getState().isWorkspaceMode) return true;

  // Allow terminal when active tab has a saved file (use its parent dir as cwd)
  const windowLabel = getCurrentWindowLabel();
  const activeTabId = useTabStore.getState().activeTabId[windowLabel];
  if (activeTabId) {
    const doc = useDocumentStore.getState().getDocument(activeTabId);
    if (doc?.filePath) return true;
  }

  return false;
}

/** Gate terminal toggle: show toast if no workspace when opening. */
export function requestToggleTerminal(): void {
  const isVisible = useUIStore.getState().terminalVisible;
  if (!isVisible && !canOpenTerminal()) {
    toast.info(i18n.t("dialog:toast.terminalNeedsWorkspace"));
    return;
  }
  useUIStore.getState().toggleTerminal();
}
