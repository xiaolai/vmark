/**
 * Hot-exit restore dispatch
 *
 * Purpose: Single source of truth for choosing between single-window and
 * multi-window restore. Both the automatic restart flow (restartWithHotExit)
 * and the manual "Test Restore" button (AdvancedSettings) must use this so a
 * multi-window session is never silently collapsed to its main window (#970).
 *
 * @module services/persistence/hotExit/restoreDispatch
 */

import type { SessionData } from "./types";

/** Tauri command: restore only the main window from a session. */
export const HOT_EXIT_RESTORE = "hot_exit_restore";
/** Tauri command: restore the main window plus all secondary windows. */
export const HOT_EXIT_RESTORE_MULTI = "hot_exit_restore_multi_window";

/** True if the session contains any non-main (secondary) window. */
export function hasSecondaryWindows(session: SessionData): boolean {
  return session.windows.some((w) => !w.is_main_window);
}

/**
 * The restore command that matches the session's window topology: the
 * multi-window command when secondary windows are present, otherwise the
 * single-window command.
 */
export function restoreCommandFor(
  session: SessionData,
): typeof HOT_EXIT_RESTORE | typeof HOT_EXIT_RESTORE_MULTI {
  return hasSecondaryWindows(session) ? HOT_EXIT_RESTORE_MULTI : HOT_EXIT_RESTORE;
}
