import { useEffect } from "react";
import { useIsDocumentWindow, useWindowLabel } from "@/contexts/WindowContext";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { openOrActivateWorkspaceInstance } from "@/services/workspaces/workspaceInstanceActions";
import { generateUUID } from "@/utils/workspaceIdentity";

/** Seeds the rail model when rail mode is enabled after startup. */
export function useWorkspaceRailSeed(): void {
  const windowLabel = useWindowLabel();
  const isDocumentWindow = useIsDocumentWindow();
  const railEnabled = useSettingsStore((state) => state.general.workspaceRailMode);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const isWorkspaceMode = useWorkspaceStore((state) => state.isWorkspaceMode);
  const instanceCount = useWorkspaceInstancesStore(
    (state) => state.windows[windowLabel]?.workspaceInstanceIds.length ?? 0,
  );

  useEffect(() => {
    if (!isDocumentWindow || !railEnabled || !isWorkspaceMode || !rootPath) return;
    openOrActivateWorkspaceInstance(rootPath, {
      windowLabel,
      createdFrom: "restore",
    });
  }, [isDocumentWindow, isWorkspaceMode, railEnabled, rootPath, windowLabel]);

  useEffect(() => {
    if (!isDocumentWindow || !railEnabled || isWorkspaceMode || instanceCount > 0) return;
    useWorkspaceInstancesStore
      .getState()
      .ensurePlaceholderInstance(windowLabel, `wsi-placeholder-${generateUUID()}`);
  }, [instanceCount, isDocumentWindow, isWorkspaceMode, railEnabled, windowLabel]);
}
