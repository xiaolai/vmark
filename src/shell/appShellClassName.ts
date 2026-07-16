/**
 * appShellClassName
 *
 * Purpose: Compute the AppShell root's modifier class list from the document
 * window's UI flags. Extracted from App.tsx so the modifier set stays readable
 * and testable instead of a single compressed expression.
 *
 * @module shell/appShellClassName
 */

export interface AppShellFlags {
  focusMode: boolean;
  typewriterMode: boolean;
  findBarOpen: boolean;
  browserWorkspaceActive: boolean;
  workspaceRailVisible: boolean;
}

/** Space-joined modifier classes for the AppShell root (falsy flags omitted). */
export function appShellClassName(flags: AppShellFlags): string {
  return [
    flags.focusMode && "focus-mode",
    flags.typewriterMode && "typewriter-mode",
    flags.findBarOpen && "find-bar-open",
    flags.browserWorkspaceActive && "browser-workspace-active",
    flags.workspaceRailVisible && "workspace-rail-visible",
  ]
    .filter(Boolean)
    .join(" ");
}
