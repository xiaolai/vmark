/**
 * openTerminalHere
 *
 * Purpose: "Open Terminal Here" (F2/WI-4.2) — create a terminal session
 * anchored to a specific directory and reveal the panel. Lives in `services/`
 * rather than in the file-explorer component because both the explorer context
 * menu and (later) any other surface should be able to call it without a
 * cross-feature import.
 *
 * Key decisions:
 *   - The requested directory is carried on the session record and consumed
 *     ONCE by the spawn path. It must outrank the sibling-cwd inheritance in
 *     `useTerminalShellLifecycle`, which would otherwise silently open the new
 *     terminal wherever another session happens to be — the one directory the
 *     user did not ask for.
 *   - At MAX_TERMINAL_SESSIONS the call fails with a reason rather than
 *     silently doing nothing, so the caller can disable or explain the action
 *     instead of leaving a dead menu item.
 *   - Reveals the panel when hidden. Creating an invisible session would look
 *     like the command did nothing.
 *
 * @coordinates-with components/Sidebar/FileExplorer/FileExplorer.tsx — context-menu action
 * @coordinates-with components/Terminal/useTerminalShellLifecycle.ts — consumes requestedCwd
 * @coordinates-with stores/uiStore/terminalSlice.ts — terminalCreateSession({ requestedCwd })
 * @coordinates-with services/terminal/revealTerminalSession.ts — shared create + reveal
 * @module services/terminal/openTerminalHere
 */
import { useUIStore, MAX_TERMINAL_SESSIONS } from "@/stores/uiStore";
import { createTerminalSessionAt } from "./revealTerminalSession";

/** Why an "Open Terminal Here" request could not be satisfied. */
export type OpenTerminalHereFailure = "no-directory" | "max-sessions";

export interface OpenTerminalHereResult {
  ok: boolean;
  /** Set when `ok` is false. */
  reason?: OpenTerminalHereFailure;
  /** The new session's id, when one was created. */
  sessionId?: string;
}

/** True when another terminal session can still be created. */
export function canOpenTerminalHere(): boolean {
  return useUIStore.getState().terminal.sessions.length < MAX_TERMINAL_SESSIONS;
}

/**
 * Create a terminal session starting in `dirPath` and show the panel.
 * Returns a result rather than throwing — a context-menu action should never
 * surface an exception.
 */
export function openTerminalHere(dirPath: string): OpenTerminalHereResult {
  // `trim()` decides only whether a path was GIVEN — the path itself is passed
  // through verbatim. A directory named " notes " is legal on macOS and Linux,
  // and trimming it would spawn the shell somewhere else (or nowhere).
  if (!dirPath || !dirPath.trim()) return { ok: false, reason: "no-directory" };

  const sessionId = createTerminalSessionAt(dirPath);
  // The only way creation fails is the session cap.
  if (!sessionId) return { ok: false, reason: "max-sessions" };
  return { ok: true, sessionId };
}
