/**
 * resolveTerminalSpawnContext — the spawn env/cwd contract (WI-TS4.1, D-T9).
 *
 * Purpose: ONE named rule for what directory a session's shell starts in and
 * what VMARK_WORKSPACE it carries:
 *
 *   cwd:  requestedCwd ("Open Terminal Here")
 *         ?? a SAME-SCOPE sibling's live OSC-7 cwd
 *         ?? (stamped & owner alive: owner's rootPath ?? active file's parent)
 *         ?? (unscoped / owner deleted: active-scope root ?? active file's parent)
 *   workspaceRoot (→ VMARK_WORKSPACE):
 *         stamped & owner alive: owner's rootPath
 *         else: active-scope resolution as today — deliberately WITHOUT an
 *         isWorkspaceMode check (resolveTerminalWorkspaceRoot's existing
 *         behavior for the unscoped fallback; preserved, not silently fixed).
 *
 * The caller resolves this ONCE, before the spawn await, and spawnPty stops
 * re-resolving — so a rail switch mid-spawn can no longer hand the shell a
 * different scope's cwd/VMARK_WORKSPACE (the D-T9 race). A missing owner
 * (deleted mid-spawn) falls back to the active scope: spawn only ever starts
 * for a visible session, so that is the degenerate case, not the norm.
 *
 * @coordinates-with useTerminalShellLifecycle.ts — sole production caller
 * @coordinates-with spawnPty.ts — consumes { cwd, workspaceRoot }
 * @module components/Terminal/resolveTerminalSpawnContext
 */
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import type { TerminalSession } from "@/stores/uiStore/types";
import {
  resolveActiveFileCwd,
  resolveTerminalWorkspaceRoot,
} from "./spawnPty";

export interface TerminalSpawnContext {
  cwd?: string;
  workspaceRoot?: string;
}

/**
 * Resolve the spawn context for `session`. `liveSiblingCwd` returns a
 * sibling's OSC-7 cwd only while that sibling's shell is alive (the caller
 * owns the xterm entries; this module never touches them). An undefined
 * `session` (store entry already gone mid-teardown) resolves as unscoped
 * with no request — the pre-scoping default.
 */
export function resolveTerminalSpawnContext(
  windowLabel: string,
  session: TerminalSession | undefined,
  liveSiblingCwd: (sessionId: string) => string | undefined,
): TerminalSpawnContext {
  const scopeKey = session?.workspaceInstanceId ?? null;
  const owner = scopeKey
    ? useWorkspaceInstancesStore.getState().instances[scopeKey]
    : undefined;

  const workspaceRoot = owner
    ? owner.rootPath ?? undefined
    : resolveTerminalWorkspaceRoot(windowLabel);

  // WI-4.2: an explicit request outranks everything.
  let cwd: string | undefined = session?.requestedCwd;

  // WI-2.2, scope-narrowed (D-T9): inherit a live sibling's cwd, but only
  // from the SAME scope — another workspace's shell is somewhere the user
  // never put THIS scope.
  if (!cwd && session) {
    for (const sibling of useUIStore.getState().terminal.sessions) {
      if (sibling.id === session.id) continue;
      if ((sibling.workspaceInstanceId ?? null) !== scopeKey) continue;
      const live = liveSiblingCwd(sibling.id);
      if (live) {
        cwd = live;
        break;
      }
    }
  }

  if (!cwd) {
    cwd = owner
      ? owner.rootPath ?? resolveActiveFileCwd(windowLabel)
      : resolveTerminalWorkspaceRoot(windowLabel) ?? resolveActiveFileCwd(windowLabel);
  }

  return {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
  };
}
