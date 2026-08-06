/**
 * Idempotent context hydration (WI-13.1 / plan D6).
 *
 * Purpose: the startup/repair counterpart to `switchWorkspaceInstance`.
 * Applies the window's CURRENT active instance's context — pane layout,
 * active tab, legacy sidebar root — WITHOUT stashing anything (there is no
 * meaningful "outgoing" context during restore, and stashing a half-built
 * one would corrupt the incoming instance's records).
 *
 * Used after hot-exit restore reconciliation (WI-13.2), after close/remove/
 * move picked a structural successor, and whenever a repair needs to make the
 * visible surfaces agree with the active instance again. Safe to call twice.
 *
 * @coordinates-with switchWorkspaceInstance.ts — the user-switch counterpart
 * @coordinates-with syncLegacyWorkspaceContext.ts — sidebar re-root
 * @module services/workspaces/hydrateWorkspaceInstanceContext
 */
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  contextKindOf,
  resolveIncomingActiveTab,
} from "./workspaceOwnershipKernel";
import { orderedWindowInstances } from "./workspaceContextOwnership";
import { bumpContextGeneration } from "./workspaceContextGeneration";
import { sanitizeSplitForInstance } from "./switchWorkspaceInstance";
import { syncLegacyWorkspaceContext } from "./syncLegacyWorkspaceContext";

/**
 * Apply the active instance's context to the window's visible surfaces.
 * Resolves when the async legacy-config refresh settled (or was discarded).
 */
export function hydrateWorkspaceInstanceContext(windowLabel: string): Promise<void> {
  if (!isWorkspaceRailEnabled()) return Promise.resolve();

  const store = useWorkspaceInstancesStore.getState();
  const activeId = store.windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  const active = activeId ? store.instances[activeId] : null;
  if (!activeId || !active) return Promise.resolve();

  const generation = bumpContextGeneration(windowLabel);

  const liveTabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const instances = orderedWindowInstances(windowLabel);
  const fallbackActive = resolveIncomingActiveTab(active, liveTabs, instances);
  const stashed = useWorkspacePaneLayoutsStore.getState().getPaneLayout(activeId);
  // Audit R2-F4: hydration restores persisted/stashed splits — sanitize
  // ownership through the same kernel-backed rule as the switch coordinator.
  usePaneStore.getState().replaceWindowSplit(
    windowLabel,
    sanitizeSplitForInstance(stashed, activeId, liveTabs, instances),
    fallbackActive,
  );

  return syncLegacyWorkspaceContext(
    windowLabel,
    { kind: contextKindOf(active), rootPath: active.rootPath ?? null },
    generation,
  );
}
