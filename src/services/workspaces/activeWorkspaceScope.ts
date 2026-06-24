import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { useWorkspaceInstancesStore, selectActiveWorkspaceInstance } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";

type ActiveWorkspaceScopeSource = "legacy" | "legacyFallback" | "instance";

export interface ActiveWorkspaceScope {
  windowLabel: string;
  source: ActiveWorkspaceScopeSource;
  workspaceInstanceId: string | null;
  rootPath: string | null;
  isWorkspaceMode: boolean;
  config: WorkspaceConfig | null;
  excludeFolders: string[];
}

export function getActiveWorkspaceScope(windowLabel: string): ActiveWorkspaceScope {
  const legacy = getLegacyScope(windowLabel, "legacy");
  if (!isWorkspaceRailEnabled()) return legacy;

  const instance = selectActiveWorkspaceInstance(
    useWorkspaceInstancesStore.getState(),
    windowLabel,
  );
  if (!instance) return { ...legacy, source: "legacyFallback" };

  const config = instance.rootPath === legacy.rootPath ? legacy.config : null;
  return {
    windowLabel,
    source: "instance",
    workspaceInstanceId: instance.workspaceInstanceId,
    rootPath: instance.rootPath,
    isWorkspaceMode: Boolean(instance.rootPath),
    config,
    excludeFolders: config?.excludeFolders ?? [],
  };
}

function getLegacyScope(
  windowLabel: string,
  source: ActiveWorkspaceScopeSource,
): ActiveWorkspaceScope {
  const state = useWorkspaceStore.getState();
  const config = state.config ?? null;
  return {
    windowLabel,
    source,
    workspaceInstanceId: null,
    rootPath: state.rootPath ?? null,
    isWorkspaceMode: state.isWorkspaceMode,
    config,
    excludeFolders: config?.excludeFolders ?? [],
  };
}
