/**
 * terminalCdFollow — THE cd-follow predicate (WI-TS2.1, D-T4/D-T15).
 *
 * Purpose: workspace-root changes auto-`cd` only EFFECTIVELY WINDOW-SCOPED
 * sessions. A session stamped with an owning workspace instance keeps its own
 * cwd — its workspace never "changes" under it; a rail switch hides it
 * instead (D-T3). One predicate, applied at every cd site: the syncRoot loop,
 * the null-root invalidation, the post-spawn catch-up, and inside
 * flushPendingRoot (the OSC-133 idle flush — an independent cd path).
 *
 * Rail-aware (D-T15): with the rail OFF every session is followable — stamps
 * are inert, never consulted, so behavior is byte-identical to pre-scoping.
 *
 * @coordinates-with components/Terminal/terminalSessionStoreSync.ts — sync + flush sites
 * @coordinates-with components/Terminal/useTerminalShellLifecycle.ts — post-spawn site
 * @module services/terminal/terminalCdFollow
 */
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { useUIStore } from "@/stores/uiStore";

/**
 * Should a workspace-root change write a `cd` into this session?
 * Owner is resolved from the store AT CHECK TIME (not captured), so a session
 * adopted after a pendingRoot was recorded is correctly refused at flush.
 */
export function shouldFollowWorkspaceCd(sessionId: string): boolean {
  const session = useUIStore
    .getState()
    .terminal.sessions.find((s) => s.id === sessionId);
  // Unknown id ⇒ the session is mid-teardown; never write into a dying shell
  // in EITHER rail mode (audit 20260831 #16 — the rail-off early return used
  // to treat an unknown session as followable, contradicting this guard).
  if (session === undefined) return false;
  // Rail off ⇒ every existing session follows, exactly as before scoping —
  // stamps are inert (D-T15).
  if (!isWorkspaceRailEnabled()) return true;
  return !session.workspaceInstanceId;
}
