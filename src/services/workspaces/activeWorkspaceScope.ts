import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  useWorkspaceInstancesStore,
  selectActiveWorkspaceInstance,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { getRuntimePlatform } from "@/utils/platform";

/** Normalized identity (rootId) of a legacy root path, or null when absent. */
export function resolveLegacyRootId(rootPath: string | null): string | null {
  if (!rootPath) return null;
  const identity = createWorkspaceRootIdentity(rootPath, {
    platform: getRuntimePlatform(),
  });
  return identity.ok ? identity.root.rootId : null;
}

type ActiveWorkspaceScopeSource = "legacy" | "legacyFallback" | "instance";

export interface ActiveWorkspaceScope {
  windowLabel: string;
  source: ActiveWorkspaceScopeSource;
  workspaceInstanceId: string | null;
  kind: "workspace" | "loose" | "placeholder" | "legacy" | null;
  rootPath: string | null;
  isWorkspaceMode: boolean;
  unavailableRoot: boolean;
  config: WorkspaceConfig | null;
  excludeFolders: string[];
}

/**
 * Pre-resolved inputs for {@link buildActiveWorkspaceScope}. Both the
 * imperative service (`getActiveWorkspaceScope`) and the React hook
 * (`useActiveWorkspaceScope`) gather these from their respective store-access
 * styles and delegate the scope construction here so the rules stay in one
 * place and cannot drift between React and non-React callers.
 */
export interface ActiveWorkspaceScopeInputs {
  windowLabel: string;
  railEnabled: boolean;
  legacyRootPath: string | null;
  legacyConfig: WorkspaceConfig | null;
  legacyMode: boolean;
  activeInstance: WorkspaceInstanceRecord | null;
  /**
   * Normalized identity (`rootId`) of the legacy root, used to decide whether
   * the active instance is the same workspace as the legacy store and may
   * therefore reuse its config. Resolving by identity rather than raw-string
   * equality means trailing-separator / case-variant roots still match on
   * case-insensitive platforms (otherwise each instance silently loses its
   * excludeFolders/config unless it is the exact current legacy root). Optional:
   * when omitted, falls back to raw `rootPath` string equality.
   */
  legacyRootId?: string | null;
}

/** Pure active-scope resolver shared by the service and the React hook. */
export function buildActiveWorkspaceScope(
  inputs: ActiveWorkspaceScopeInputs,
): ActiveWorkspaceScope {
  const legacy = buildLegacyScope(inputs, "legacy");
  if (!inputs.railEnabled) return legacy;

  const instance = inputs.activeInstance;
  if (!instance) return { ...legacy, source: "legacyFallback" };

  // Reuse legacy config only when the active instance is the SAME workspace as
  // the legacy root. Prefer normalized identity (rootId) so separator/case
  // variants of the same root still match; fall back to raw path equality when
  // no identity was provided.
  const sameRoot =
    inputs.legacyRootId != null && instance.rootId != null
      ? instance.rootId === inputs.legacyRootId
      : instance.rootPath === legacy.rootPath;
  const config = sameRoot ? legacy.config : null;
  return {
    windowLabel: inputs.windowLabel,
    source: "instance",
    workspaceInstanceId: instance.workspaceInstanceId,
    kind: instance.kind,
    rootPath: instance.rootPath,
    isWorkspaceMode:
      instance.kind === "workspace"
      && Boolean(instance.rootPath)
      && !instance.unavailableRoot,
    unavailableRoot: instance.unavailableRoot ?? false,
    config,
    excludeFolders: config?.excludeFolders ?? [],
  };
}

export function getActiveWorkspaceScope(windowLabel: string): ActiveWorkspaceScope {
  const state = useWorkspaceStore.getState();
  return buildActiveWorkspaceScope({
    windowLabel,
    railEnabled: isWorkspaceRailEnabled(),
    legacyRootPath: state.rootPath ?? null,
    legacyRootId: resolveLegacyRootId(state.rootPath ?? null),
    legacyConfig: state.config ?? null,
    legacyMode: state.isWorkspaceMode,
    activeInstance: selectActiveWorkspaceInstance(
      useWorkspaceInstancesStore.getState(),
      windowLabel,
    ),
  });
}

function buildLegacyScope(
  inputs: ActiveWorkspaceScopeInputs,
  source: "legacy" | "legacyFallback",
): ActiveWorkspaceScope {
  const config = inputs.legacyConfig ?? null;
  return {
    windowLabel: inputs.windowLabel,
    source,
    workspaceInstanceId: null,
    kind: "legacy",
    rootPath: inputs.legacyRootPath ?? null,
    isWorkspaceMode: inputs.legacyMode,
    unavailableRoot: false,
    config,
    excludeFolders: config?.excludeFolders ?? [],
  };
}
