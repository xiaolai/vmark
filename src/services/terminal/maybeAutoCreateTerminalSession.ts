/**
 * maybeAutoCreateTerminalSession — THE auto-create gate (WI-TS3.2, D-T8).
 *
 * Purpose: both auto-creators — the panel's visibility effect and the
 * mount-time creator in useTerminalSessionsInit — go through this one
 * helper, so the gate cannot fork between them.
 *
 * The gate is `canAutoCreateInScope` over `getActiveWorkspaceScope` — the
 * SYNCHRONOUS, instance-backed scope. It deliberately never consults
 * `canOpenTerminal()`: that reads the LEGACY workspace store, which only the
 * async `syncLegacyWorkspaceContext` refresh updates (and never after a
 * close), so gating on it races the very scope it gates (D-T8). A refusal
 * creates nothing — the panel renders its empty-state hint instead of
 * spawning a shell into $HOME.
 *
 * @coordinates-with components/Terminal/TerminalPanel.tsx — visibility-effect creator
 * @coordinates-with components/Terminal/useTerminalSessionsInit.ts — mount-time creator
 * @module services/terminal/maybeAutoCreateTerminalSession
 */
import {
  getActiveWorkspaceScope,
  type ActiveWorkspaceScope,
} from "@/services/workspaces/activeWorkspaceScope";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { getVisibleTerminalSessions } from "./visibleTerminalSessions";
import { createTerminalSessionInScope } from "./createTerminalSession";

/** Pure gate (D-T8): a workspace scope, or a saved file to anchor a cwd. */
export function canAutoCreateInScope(
  scope: Pick<ActiveWorkspaceScope, "isWorkspaceMode">,
  activeTabHasSavedFile: boolean,
): boolean {
  return scope.isWorkspaceMode || activeTabHasSavedFile;
}

function activeTabHasSavedFile(windowLabel: string): boolean {
  const activeTabId = useTabStore.getState().activeTabId[windowLabel];
  if (!activeTabId) return false;
  return Boolean(useDocumentStore.getState().getDocument(activeTabId)?.filePath);
}

/**
 * Create one session in the active scope when the VISIBLE population is
 * empty and the scope can host a terminal. Returns true iff a session was
 * created. Idempotent across both creators: whichever runs second sees a
 * non-empty visible population and does nothing.
 */
export function maybeAutoCreateTerminalSession(windowLabel: string): boolean {
  if (getVisibleTerminalSessions(windowLabel).length > 0) return false;
  const scope = getActiveWorkspaceScope(windowLabel);
  if (!canAutoCreateInScope(scope, activeTabHasSavedFile(windowLabel))) return false;
  // The ONE owner-aware creation service (audit 20260831 #17).
  return createTerminalSessionInScope(windowLabel) !== null;
}
