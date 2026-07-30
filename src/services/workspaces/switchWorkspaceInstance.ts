/**
 * Rail-switch coordinator (WI-2R) — a SMALL orchestrator over pure modules.
 *
 * Pipeline for switching window `windowLabel` to instance `instanceId`:
 *   1. GUARDS — rail on; instance belongs to this window; not already active
 *      (a same-instance click is a strict no-op; startup/repair uses
 *      `hydrateWorkspaceInstanceContext`, WI-13.1, not this).
 *   2. STASH the outgoing instance: owned tab ids from the LIVE ownership
 *      kernel (never trusting stale `tabIds`), the focused tab, the closed
 *      projection from the scoped history (a switch must never erase reopen
 *      history — invariant 6), and the pane layout (WI-10.2).
 *   3. ACTIVATE + bump the window's context generation (invariant 5).
 *   4. RESTORE the incoming instance: stashed pane layout through the ONE
 *      atomic pane action (`replaceWindowSplit`, WI-10.1 — the only writer of
 *      the activeTabId alias), with `resolveIncomingActiveTab` as fallback.
 *   5. LEGACY SYNC (WI-5R): synchronous sidebar re-root, async generation-
 *      guarded config refresh (the returned `refresh` promise).
 *
 * Nothing here closes tabs or removes documents (issue #1005 principle):
 * hidden workspaces' dirty documents keep autosaving and survive untouched.
 *
 * @coordinates-with workspaceOwnershipKernel.ts — ownership partition
 * @coordinates-with stores/workspacePaneLayoutsStore.ts — pane stash
 * @coordinates-with stores/paneStore.ts — atomic restore (ADR-1 alias)
 * @coordinates-with syncLegacyWorkspaceContext.ts — sidebar re-root
 * @module services/workspaces/switchWorkspaceInstance
 */
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import {
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  contextKindOf,
  partitionWindowTabs,
  resolveIncomingActiveTab,
} from "./workspaceOwnershipKernel";
import { orderedWindowInstances } from "./workspaceContextOwnership";
import { bumpContextGeneration } from "./workspaceContextGeneration";
import { syncLegacyWorkspaceContext } from "./syncLegacyWorkspaceContext";

export interface SwitchWorkspaceResult {
  /** False when a guard declined the switch (unknown id, same instance, rail off). */
  switched: boolean;
  workspaceInstanceId: string | null;
  /** Settles when the async legacy-config refresh completed (or was discarded). */
  refresh: Promise<void>;
}

const declined = (workspaceInstanceId: string | null = null): SwitchWorkspaceResult => ({
  switched: false,
  workspaceInstanceId,
  refresh: Promise.resolve(),
});

// WI-13.2: while a window's hot-exit restore is rebuilding instances/tabs, a
// user rail click must not stash or restore a half-built context. Restore ends
// with ONE hydrateWorkspaceInstanceContext, after which switching resumes.
const restoringWindows = new Set<string>();

export function beginWindowContextRestore(windowLabel: string): void {
  restoringWindows.add(windowLabel);
  // A restore supersedes any in-flight async context work (audit R2-F1): an
  // earlier switch's config read must not land mid-restore.
  bumpContextGeneration(windowLabel);
}

export function endWindowContextRestore(windowLabel: string): void {
  restoringWindows.delete(windowLabel);
}

export function isWindowContextRestoring(windowLabel: string): boolean {
  return restoringWindows.has(windowLabel);
}

/** Stash the outgoing instance's live context (tabs, focus, panes). */
function stashOutgoingInstance(windowLabel: string, outgoingId: string): void {
  const store = useWorkspaceInstancesStore.getState();
  const outgoing = store.instances[outgoingId];
  if (!outgoing) return;

  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const partition = partitionWindowTabs(tabs, orderedWindowInstances(windowLabel), outgoingId);
  const ownedIds = partition.byScope.get(outgoingId) ?? [];

  const currentActive = useTabStore.getState().activeTabId[windowLabel] ?? null;
  // Record only an OWNED tab (audit R2-F2): a foreign/stale id would sit on
  // the record until the kernel corrected it at use time.
  const activeForStash =
    currentActive && ownedIds.includes(currentActive)
      ? currentActive
      : outgoing.activeTabId && ownedIds.includes(outgoing.activeTabId)
        ? outgoing.activeTabId
        : ownedIds[0] ?? null;

  // The closed projection comes from the scoped history — passing the store
  // default ([]) here is exactly the bug invariant 6 forbids.
  const closedIds = useClosedTabScopesStore
    .getState()
    .closedIdsForScope(windowLabel, outgoingId);

  store.setWorkspaceInstanceTabs(outgoingId, ownedIds, activeForStash, closedIds);
  useWorkspacePaneLayoutsStore
    .getState()
    .stashPaneLayout(outgoingId, usePaneStore.getState().getSplit(windowLabel));
}

/** Restore the incoming instance's panes/active tab via the atomic pane action. */
function restoreIncomingInstance(windowLabel: string, instanceId: string): void {
  const incoming = useWorkspaceInstancesStore.getState().instances[instanceId];
  if (!incoming) return;

  const liveTabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const instances = orderedWindowInstances(windowLabel);
  const fallbackActive = resolveIncomingActiveTab(incoming, liveTabs, instances);
  const stashed = useWorkspacePaneLayoutsStore.getState().getPaneLayout(instanceId);
  usePaneStore.getState().replaceWindowSplit(
    windowLabel,
    sanitizeSplitForInstance(stashed, instanceId, liveTabs, instances),
    fallbackActive,
  );
}

/**
 * Audit R2-F3: a stashed split may reference tabs that were REASSIGNED to
 * another instance while hidden (Save As, rename). replaceWindowSplit only
 * checks liveness — ownership must be enforced here, through the kernel.
 */
export function sanitizeSplitForInstance(
  split: import("@/stores/paneStore").WindowSplit | null,
  instanceId: string,
  liveTabs: readonly import("@/stores/tabStore").Tab[],
  instances: readonly import("@/stores/workspaceInstancesStore").WorkspaceInstanceRecord[],
): import("@/stores/paneStore").WindowSplit | null {
  if (!split?.enabled) return split;
  const { ownerOf } = partitionWindowTabs(liveTabs, instances, instanceId);
  const owned = (tabId: string | null) =>
    tabId !== null && ownerOf.get(tabId) === instanceId ? tabId : null;
  return {
    ...split,
    primaryTabId: owned(split.primaryTabId),
    secondaryTabId: owned(split.secondaryTabId),
  };
}

export interface SwitchWorkspaceOptions {
  /** WI-13.3: config the open path already read — skips the disk re-read. */
  preloadedConfig?: import("@/stores/workspaceStore").WorkspaceConfig | null;
}

/**
 * Switch the window's visible workspace context to `instanceId`.
 * Synchronous context application completes before this returns.
 */
export function switchWorkspaceInstance(
  windowLabel: string,
  instanceId: string,
  options: SwitchWorkspaceOptions = {},
): SwitchWorkspaceResult {
  if (!isWorkspaceRailEnabled()) return declined();
  if (restoringWindows.has(windowLabel)) return declined();

  const store = useWorkspaceInstancesStore.getState();
  const windowState = store.windows[windowLabel];
  if (!windowState?.workspaceInstanceIds.includes(instanceId)) return declined();

  const outgoingId = windowState.activeWorkspaceInstanceId;
  if (outgoingId === instanceId) return declined(instanceId);

  if (outgoingId) stashOutgoingInstance(windowLabel, outgoingId);

  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(windowLabel, instanceId);
  const generation = bumpContextGeneration(windowLabel);

  restoreIncomingInstance(windowLabel, instanceId);

  const incoming = useWorkspaceInstancesStore.getState().instances[instanceId];
  const refresh = incoming
    ? syncLegacyWorkspaceContext(
        windowLabel,
        { kind: contextKindOf(incoming), rootPath: incoming.rootPath ?? null },
        generation,
        options.preloadedConfig,
      )
    : Promise.resolve();

  return { switched: true, workspaceInstanceId: instanceId, refresh };
}
