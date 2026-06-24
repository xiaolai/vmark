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

export interface OpenWorkspaceInstanceOptions {
  windowLabel?: string;
  workspaceInstanceId?: string;
  createdFrom?: WorkspaceInstanceCreatedFrom;
  platform?: WorkspacePlatform;
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
    store.activateWorkspaceInstance(windowLabel, existingId);
    return useWorkspaceInstancesStore.getState().instances[existingId] ?? null;
  }

  const instance = createWorkspaceInstance({
    workspaceInstanceId: options.workspaceInstanceId ?? `wsi-${generateUUID()}`,
    root: root.root,
    ownerWindowLabel: windowLabel,
    createdFrom: options.createdFrom ?? "open",
  });
  store.addWorkspaceInstance(instance);
  store.activateWorkspaceInstance(windowLabel, instance.workspaceInstanceId);
  return instance;
}
