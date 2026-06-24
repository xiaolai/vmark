import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { isWithinRoot, normalizePath } from "@/utils/paths";

export interface WorkspaceContextClassificationInput {
  filePath: string | null;
  instances: WorkspaceInstanceRecord[];
  activeWorkspaceInstanceId: string | null;
}

export function classifyWorkspaceContextForTab(
  input: WorkspaceContextClassificationInput,
): WorkspaceInstanceRecord | null {
  const loose = input.instances.find((instance) => contextKind(instance) === "loose") ?? null;
  if (!input.filePath) return loose;

  const workspaceMatches = input.instances
    .filter((instance) => contextKind(instance) === "workspace" && instance.rootPath)
    .filter((instance) => isWithinRoot(instance.rootPath!, input.filePath!));

  if (workspaceMatches.length === 0) return loose;

  const longestRoot = Math.max(
    ...workspaceMatches.map((instance) => normalizePath(instance.rootPath!).length),
  );
  const mostSpecific = workspaceMatches.filter(
    (instance) => normalizePath(instance.rootPath!).length === longestRoot,
  );
  return (
    mostSpecific.find(
      (instance) => instance.workspaceInstanceId === input.activeWorkspaceInstanceId,
    )
    ?? mostSpecific[0]
    ?? null
  );
}

export function claimTabForWorkspaceContext(
  windowLabel: string,
  tabId: string,
  filePath: string | null,
): WorkspaceInstanceRecord | null {
  if (!isWorkspaceRailEnabled()) return null;
  const store = useWorkspaceInstancesStore.getState();
  let windowState = store.windows[windowLabel];
  if (!windowState || windowState.workspaceInstanceIds.length === 0) {
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel);
    windowState = useWorkspaceInstancesStore.getState().windows[windowLabel];
    if (!windowState) return loose;
  }

  let instances = orderedWindowInstances(windowLabel);
  let owner = classifyWorkspaceContextForTab({
    filePath,
    instances,
    activeWorkspaceInstanceId: windowState.activeWorkspaceInstanceId,
  });
  if (!owner && (!filePath || instances.every((instance) => !instance.rootPath || !isWithinRoot(instance.rootPath, filePath)))) {
    owner = useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel);
    instances = orderedWindowInstances(windowLabel);
  }
  if (!owner) return null;

  for (const instance of instances) {
    const nextTabIds = instance.tabIds.filter((id) => id !== tabId);
    if (instance.workspaceInstanceId === owner.workspaceInstanceId) {
      nextTabIds.push(tabId);
    }
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs(
      instance.workspaceInstanceId,
      nextTabIds,
      instance.workspaceInstanceId === owner.workspaceInstanceId
        ? tabId
        : instance.activeTabId,
      instance.closedTabIds,
    );
  }
  return owner;
}

export function orderedWindowInstances(windowLabel: string): WorkspaceInstanceRecord[] {
  const state = useWorkspaceInstancesStore.getState();
  const ids = state.windows[windowLabel]?.workspaceInstanceIds ?? [];
  return ids
    .map((id) => state.instances[id])
    .filter((instance): instance is WorkspaceInstanceRecord => Boolean(instance));
}

function contextKind(instance: WorkspaceInstanceRecord): WorkspaceInstanceRecord["kind"] {
  if (instance.kind) return instance.kind;
  if (instance.rootPath) return "workspace";
  return instance.createdFrom === "placeholder" ? "placeholder" : "loose";
}
