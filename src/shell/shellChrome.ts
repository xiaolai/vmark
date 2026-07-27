/**
 * shellChrome
 *
 * Purpose: The ONE definition of how much horizontal chrome sits between the
 * window's left edge and the editor — the workspace rail plus the sidebar.
 *
 * Why it exists: App.tsx and the terminal's layout maths both needed this
 * number and each derived it independently. The terminal's copy omitted the
 * 30 px workspace rail, so with the rail enabled every horizontal terminal
 * ratio (and the 50 % cap) was computed against a width 30 px larger than the
 * editor actually had. Two derivations of one quantity is the bug; this is the
 * fix.
 *
 * @coordinates-with App.tsx — lays the shell out with this width
 * @coordinates-with components/Terminal/useTerminalPosition.ts — sizes the panel against it
 * @module shell/shellChrome
 */

/**
 * Width of the workspace rail column, in pixels. Defined HERE, with the layout
 * maths that consume it, rather than inside the rail component: importing the
 * component just to read a number dragged the whole rail (and its store
 * subscriptions) into the terminal's dependency graph. `WorkspaceRail`
 * re-exports this, and `:root`'s `--workspace-rail-width` mirrors it for
 * consumers that read the CSS var without a fallback.
 */
export const WORKSPACE_RAIL_WIDTH = 30;

export interface ShellChromeState {
  /** The workspace rail is showing (document windows with the mode on). */
  workspaceRailVisible: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
}

/** Width of the chrome to the left of the editor, in pixels. */
export function shellSideWidth(state: ShellChromeState): number {
  const rail = state.workspaceRailVisible ? WORKSPACE_RAIL_WIDTH : 0;
  const sidebar = state.sidebarVisible ? state.sidebarWidth : 0;
  return rail + sidebar;
}
