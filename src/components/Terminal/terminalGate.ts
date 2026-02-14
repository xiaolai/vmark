import { toast } from "sonner";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** Pure check — testable without side effects. */
export function canOpenTerminal(): boolean {
  return useWorkspaceStore.getState().isWorkspaceMode;
}

/** Gate terminal toggle: show toast if no workspace when opening. */
export function requestToggleTerminal(): void {
  const isVisible = useUIStore.getState().terminalVisible;
  if (!isVisible && !canOpenTerminal()) {
    toast.info("Open a folder or save your file to use the terminal.");
    return;
  }
  useUIStore.getState().toggleTerminal();
}
