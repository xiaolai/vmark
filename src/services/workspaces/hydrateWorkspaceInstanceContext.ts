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
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { contextKindOf } from "./workspaceOwnershipKernel";
import { bumpContextGeneration } from "./workspaceContextGeneration";
import { restoreInstanceVisualContext } from "./restoreInstanceContext";
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

  // Audit R2-F4 + 20260831 #22: hydration restores persisted/stashed splits
  // through the SAME shared restoration (and kernel-backed sanitization) the
  // switch coordinator uses — the two paths had grown near-identical copies.
  restoreInstanceVisualContext(windowLabel, activeId);

  // WI-TS2.2 (D-T12): home window-scoped terminal sessions into the FINAL
  // active instance and realign the shown session. Convergent by design — a
  // user switch that landed in the restore gap already adopted on its own,
  // and re-deriving activation from the active id cannot clobber it. A
  // placeholder active skips adoption (D-T1 carve-out).
  if (active.kind !== "placeholder") {
    useUIStore.getState().terminalAdoptUnscopedSessions(activeId);
  }
  useUIStore.getState().terminalHydrateScope(activeId);

  return syncLegacyWorkspaceContext(
    windowLabel,
    { kind: contextKindOf(active), rootPath: active.rootPath ?? null },
    generation,
  );
}
