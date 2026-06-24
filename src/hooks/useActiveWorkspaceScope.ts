import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore, selectActiveWorkspaceInstance } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  buildActiveWorkspaceScope,
  resolveLegacyRootId,
  type ActiveWorkspaceScope,
} from "@/services/workspaces/activeWorkspaceScope";

/**
 * React selector wrapper for the active workspace scope in a document window.
 *
 * Gathers reactive store slices via selectors (so the component re-renders on
 * change) and delegates the scope rules to the shared pure builder, keeping the
 * React and non-React (`getActiveWorkspaceScope`) paths in lockstep.
 */
export function useActiveWorkspaceScope(windowLabel: string): ActiveWorkspaceScope {
  const railEnabled = useSettingsStore((state) => state.general.workspaceRailMode);
  const legacyRootPath = useWorkspaceStore((state) => state.rootPath);
  const legacyConfig = useWorkspaceStore((state) => state.config);
  const legacyMode = useWorkspaceStore((state) => state.isWorkspaceMode);
  const activeInstance = useWorkspaceInstancesStore((state) =>
    selectActiveWorkspaceInstance(state, windowLabel)
  );

  return buildActiveWorkspaceScope({
    windowLabel,
    railEnabled,
    legacyRootPath,
    legacyRootId: resolveLegacyRootId(legacyRootPath),
    legacyConfig,
    legacyMode,
    activeInstance,
  });
}
