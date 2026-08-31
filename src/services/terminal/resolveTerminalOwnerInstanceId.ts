/**
 * resolveTerminalOwnerInstanceId — THE owner-stamping rule (WI-TS1.1, D-T1).
 *
 * Purpose: every terminal-session creator resolves the session's owning
 * workspace instance through this ONE helper, so the three carve-outs cannot
 * drift between call sites:
 *
 *   1. Never stamp a PLACEHOLDER instance's id — placeholders are deleted
 *      silently by addWorkspaceInstance/ensureLooseInstance with no lifecycle
 *      follower, which would strand a stamped session invisibly with a live
 *      PTY (invariant 3: every stamped owner exists).
 *   2. Never stamp while the window's hot-exit restore is in flight — a
 *      mid-restore auto-create would bind to the pre-reconcile active id.
 *   3. Never stamp while the rail is OFF — rail-off behaves exactly as today
 *      (D-T15); scoping is a rail-mode concept.
 *
 * Returns undefined in every carve-out ⇒ the session is window-scoped and
 * gets ADOPTED by the active instance on the next switch/hydrate.
 *
 * @coordinates-with stores/uiStore/terminalSlice.ts — terminalCreateSession consumer
 * @module services/terminal/resolveTerminalOwnerInstanceId
 */
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { isWindowContextRestoring } from "@/services/workspaces/switchWorkspaceInstance";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";

/** Owner instance id for a session created NOW in this window, or undefined
 *  (window-scoped) per the three D-T1 carve-outs. */
export function resolveTerminalOwnerInstanceId(windowLabel: string): string | undefined {
  if (!isWorkspaceRailEnabled()) return undefined;
  if (isWindowContextRestoring(windowLabel)) return undefined;
  const scope = getActiveWorkspaceScope(windowLabel);
  if (!scope.workspaceInstanceId) return undefined;
  if (scope.kind === "placeholder") return undefined;
  return scope.workspaceInstanceId;
}
