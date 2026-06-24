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

  const initialized = ensureWindowInstances(windowLabel);
  // No window state even after ensuring a loose instance — hand back whatever
  // loose instance ensure created (or null).
  if (initialized.fallback) return initialized.fallback;

  const resolved = resolveTabOwner(windowLabel, filePath, initialized.activeInstanceId);
  if (!resolved) return null;

  reassignTabToOwner(resolved.instances, tabId, resolved.owner);
  return resolved.owner;
}

/**
 * Ensure the window has at least one workspace instance. Returns the active
 * instance id for classification; when the window state is still missing after
 * ensuring a loose instance, returns that loose instance as a `fallback`.
 */
function ensureWindowInstances(
  windowLabel: string,
): { activeInstanceId: string | null; fallback?: WorkspaceInstanceRecord | null } {
  const store = useWorkspaceInstancesStore.getState();
  let windowState = store.windows[windowLabel];
  if (!windowState || windowState.workspaceInstanceIds.length === 0) {
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel);
    windowState = useWorkspaceInstancesStore.getState().windows[windowLabel];
    if (!windowState) return { activeInstanceId: null, fallback: loose };
  }
  return { activeInstanceId: windowState.activeWorkspaceInstanceId };
}

/**
 * Resolve the owning instance for a tab, falling back to a loose instance when
 * no workspace root contains the file. Returns the (possibly refreshed)
 * instance list alongside the owner so the caller can reassign in one pass.
 */
function resolveTabOwner(
  windowLabel: string,
  filePath: string | null,
  activeWorkspaceInstanceId: string | null,
): { owner: WorkspaceInstanceRecord; instances: WorkspaceInstanceRecord[] } | null {
  let instances = orderedWindowInstances(windowLabel);
  let owner = classifyWorkspaceContextForTab({
    filePath,
    instances,
    activeWorkspaceInstanceId,
  });
  const noContainingRoot =
    !filePath
    || instances.every((instance) => !instance.rootPath || !isWithinRoot(instance.rootPath, filePath));
  if (!owner && noContainingRoot) {
    owner = useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel);
    instances = orderedWindowInstances(windowLabel);
  }
  return owner ? { owner, instances } : null;
}

/** Move `tabId` so it belongs only to `owner`, updating active tab per instance. */
function reassignTabToOwner(
  instances: WorkspaceInstanceRecord[],
  tabId: string,
  owner: WorkspaceInstanceRecord,
): void {
  for (const instance of instances) {
    const isOwner = instance.workspaceInstanceId === owner.workspaceInstanceId;
    const nextTabIds = instance.tabIds.filter((id) => id !== tabId);
    if (isOwner) nextTabIds.push(tabId);
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs(
      instance.workspaceInstanceId,
      nextTabIds,
      isOwner ? tabId : instance.activeTabId,
      instance.closedTabIds,
    );
  }
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
