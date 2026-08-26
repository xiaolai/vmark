/**
 * Finder open-branch resolution (pure)
 *
 * Purpose: Decides WHICH open strategy a Finder file-open should take
 *   (activate an existing tab, replace a clean untitled tab, create a new tab
 *   in this window, or open a new window) given the current window/workspace
 *   state. Extracted from the imperative `useFinderFileOpen` hook so the policy
 *   is unit-testable without the Tauri event pipeline, store mocks, or the
 *   async read/indicator lifecycle.
 *
 * @coordinates-with useFinderFileOpen.ts — sole caller; executes the branch
 * @module services/navigation/finderOpenBranch
 */

import { isWithinRoot } from "@/utils/paths";

/**
 * True when the file should open as a new tab in the current window.
 *
 * Matches the same window in three cases:
 *   - file lives in the current workspace
 *   - both current and incoming have no workspace
 *   - current has no workspace and the incoming one should be adopted
 */
export function isSameWorkspace(
  filePath: string,
  currentRoot: string | null,
  incomingWorkspace: string | null,
): boolean {
  const fileInCurrentWorkspace = currentRoot
    ? isWithinRoot(currentRoot, filePath)
    : false;
  return incomingWorkspace
    ? currentRoot === incomingWorkspace || fileInCurrentWorkspace || !currentRoot
    : fileInCurrentWorkspace || !currentRoot;
}

export type FinderOpenBranch =
  | { kind: "activate"; tabId: string }
  | { kind: "replace"; replaceableTabId: string; adoptWorkspace: boolean }
  | { kind: "create"; adoptWorkspace: boolean }
  | { kind: "newWindow" };

export interface FinderOpenBranchInput {
  filePath: string;
  /** Tab already open for this exact file, if any. */
  existingTabId: string | null;
  /** A single clean untitled tab that can be reused, if any. */
  replaceableTabId: string | null;
  /** Whether the workspace rail/window model is enabled. */
  workspaceRailMode: boolean;
  /** Current window's workspace root (null if none). */
  currentRoot: string | null;
  /** Workspace root the incoming file brings, if any. */
  incomingWorkspace: string | null;
}

/**
 * Resolve the open branch. Precedence:
 *   1. existing tab   → activate
 *   2. rail mode      → land in this window (no workspace adoption — the rail
 *                       owns workspace identity)
 *   3. same workspace → land in this window, adopting the incoming workspace
 *                       only when this window has none
 *   4. otherwise      → new window (different workspace)
 *
 * Within 2 and 3, a single clean untitled tab is reused instead of adding one.
 *
 * REUSING THAT TAB IS NOT A LICENCE TO RE-ROOT THE WINDOW (#1330). The
 * replaceable-tab check used to sit at the top, above both the rail rule and
 * the workspace check, and the replace path then opened the incoming
 * workspace unconditionally — so double-clicking a file from another folder
 * silently replaced the sidebar tree of a window whose only tab happened to be
 * untitled. "One clean untitled tab" describes the TABS; it says nothing about
 * whether the window owns a workspace, which is exactly the state a window is
 * in right after File → Open Workspace.
 */
export function resolveFinderOpenBranch(input: FinderOpenBranchInput): FinderOpenBranch {
  if (input.existingTabId) {
    return { kind: "activate", tabId: input.existingTabId };
  }
  if (input.workspaceRailMode) {
    return landInThisWindow(input, false);
  }
  if (isSameWorkspace(input.filePath, input.currentRoot, input.incomingWorkspace)) {
    return landInThisWindow(input, !input.currentRoot);
  }
  return { kind: "newWindow" };
}

/** Reuse the lone clean untitled tab when there is one; otherwise add a tab. */
function landInThisWindow(
  input: FinderOpenBranchInput,
  adoptWorkspace: boolean,
): FinderOpenBranch {
  return input.replaceableTabId
    ? { kind: "replace", replaceableTabId: input.replaceableTabId, adoptWorkspace }
    : { kind: "create", adoptWorkspace };
}
