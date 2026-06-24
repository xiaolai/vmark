import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore, selectActiveWorkspaceInstance } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import type { ActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";

/** React selector wrapper for the active workspace scope in a document window. */
export function useActiveWorkspaceScope(windowLabel: string): ActiveWorkspaceScope {
  const railEnabled = useSettingsStore((state) => state.general.workspaceRailMode);
  const legacyRootPath = useWorkspaceStore((state) => state.rootPath);
  const legacyConfig = useWorkspaceStore((state) => state.config);
  const legacyMode = useWorkspaceStore((state) => state.isWorkspaceMode);
  const activeInstance = useWorkspaceInstancesStore((state) =>
    selectActiveWorkspaceInstance(state, windowLabel)
  );

  if (!railEnabled) {
    return legacyScope(windowLabel, legacyRootPath, legacyMode, legacyConfig, "legacy");
  }

  if (!activeInstance) {
    return legacyScope(
      windowLabel,
      legacyRootPath,
      legacyMode,
      legacyConfig,
      "legacyFallback",
    );
  }

  const config = activeInstance.rootPath === legacyRootPath ? legacyConfig : null;
  return {
    windowLabel,
    source: "instance",
    workspaceInstanceId: activeInstance.workspaceInstanceId,
    kind: activeInstance.kind,
    rootPath: activeInstance.rootPath,
    isWorkspaceMode:
      activeInstance.kind === "workspace"
      && Boolean(activeInstance.rootPath)
      && !activeInstance.unavailableRoot,
    unavailableRoot: activeInstance.unavailableRoot ?? false,
    config,
    excludeFolders: config?.excludeFolders ?? [],
  };
}

function legacyScope(
  windowLabel: string,
  rootPath: string | null,
  isWorkspaceMode: boolean,
  config: WorkspaceConfig | null,
  source: ActiveWorkspaceScope["source"],
): ActiveWorkspaceScope {
  return {
    windowLabel,
    source,
    workspaceInstanceId: null,
    kind: source === "legacy" || source === "legacyFallback" ? "legacy" : null,
    rootPath,
    isWorkspaceMode,
    unavailableRoot: false,
    config,
    excludeFolders: config?.excludeFolders ?? [],
  };
}
