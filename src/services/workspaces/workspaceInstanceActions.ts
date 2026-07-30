import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
  generateUUID,
  type WorkspaceInstanceCreatedFrom,
  type WorkspacePlatform,
} from "@/utils/workspaceIdentity";
import { getRuntimePlatform } from "@/utils/platform";
import type { WorkspaceConfig } from "@/stores/workspaceStore";
import { switchWorkspaceInstance } from "./switchWorkspaceInstance";

export interface OpenWorkspaceInstanceOptions {
  windowLabel?: string;
  workspaceInstanceId?: string;
  createdFrom?: WorkspaceInstanceCreatedFrom;
  platform?: WorkspacePlatform;
  /** WI-13.3: config the open path already read — the coordinator skips its
   *  disk re-read. `null` = no config file; `undefined` = not preloaded. */
  preloadedConfig?: WorkspaceConfig | null;
}

/**
 * Resolve a possibly variant root spelling to the STORED rootPath of an
 * existing same-identity instance in the window (WI-17.2). The Rust config
 * layer hashes the exact path string, so reading with `c:\repo` and writing
 * with `C:\Repo` would address two different config files on Windows. When no
 * instance matches (or the path is invalid), the input is returned unchanged.
 */
export function resolveStableRootPath(
  windowLabel: string,
  rootPath: string,
  platform?: WorkspacePlatform,
): string {
  const root = createWorkspaceRootIdentity(rootPath, {
    platform: platform ?? getRuntimePlatform(),
  });
  if (!root.ok) return rootPath;

  const store = useWorkspaceInstancesStore.getState();
  const existingId = store.windows[windowLabel]?.workspaceInstanceIds.find(
    (instanceId) => store.instances[instanceId]?.rootId === root.root.rootId,
  );
  const stored = existingId ? store.instances[existingId]?.rootPath : null;
  return stored ?? rootPath;
}

export function openOrActivateWorkspaceInstance(
  rootPath: string,
  options: OpenWorkspaceInstanceOptions = {},
): WorkspaceInstanceRecord | null {
  if (!isWorkspaceRailEnabled()) return null;
  // Derive the platform from the runtime OS at this boundary when callers omit
  // it — defaulting blindly to "macos" mis-normalizes Windows/Linux roots, so
  // duplicate detection and root identity would be wrong off macOS.
  const root = createWorkspaceRootIdentity(rootPath, {
    platform: options.platform ?? getRuntimePlatform(),
  });
  if (!root.ok) return null;

  const windowLabel = options.windowLabel ?? "main";
  const store = useWorkspaceInstancesStore.getState();
  const existingId = store.windows[windowLabel]?.workspaceInstanceIds.find(
    (instanceId) => store.instances[instanceId]?.rootId === root.root.rootId,
  );

  if (existingId) {
    // WI-13.3: File > Open of an already-railed root performs the SAME full
    // context switch as clicking its rail entry (stash outgoing, restore
    // incoming, sidebar re-root) — not a raw activation flip.
    switchWorkspaceInstance(windowLabel, existingId, {
      preloadedConfig: options.preloadedConfig,
    });
    return useWorkspaceInstancesStore.getState().instances[existingId] ?? null;
  }

  const instance = createWorkspaceInstance({
    workspaceInstanceId: options.workspaceInstanceId ?? `wsi-${generateUUID()}`,
    root: root.root,
    ownerWindowLabel: windowLabel,
    createdFrom: options.createdFrom ?? "open",
  });
  // Structural add (may fallback-select in an empty window), then the semantic
  // switch stashes the outgoing context. A fallback-selected first instance
  // makes the switch a no-op — nothing existed to stash.
  store.addWorkspaceInstance(instance);
  switchWorkspaceInstance(windowLabel, instance.workspaceInstanceId, {
    preloadedConfig: options.preloadedConfig,
  });
  return instance;
}
