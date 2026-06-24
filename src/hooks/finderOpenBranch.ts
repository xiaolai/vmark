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
 * @module hooks/finderOpenBranch
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
  | { kind: "replace"; replaceableTabId: string }
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
 *   1. existing tab    → activate
 *   2. replaceable tab → replace (reuse the clean untitled tab)
 *   3. rail mode       → always create a new tab in this window (no workspace
 *                        adoption — the rail owns workspace identity)
 *   4. same workspace  → create a new tab (adopting the incoming workspace when
 *                        this window has none)
 *   5. otherwise       → new window (different workspace)
 */
export function resolveFinderOpenBranch(input: FinderOpenBranchInput): FinderOpenBranch {
  if (input.existingTabId) {
    return { kind: "activate", tabId: input.existingTabId };
  }
  if (input.replaceableTabId) {
    return { kind: "replace", replaceableTabId: input.replaceableTabId };
  }
  if (input.workspaceRailMode) {
    return { kind: "create", adoptWorkspace: false };
  }
  if (isSameWorkspace(input.filePath, input.currentRoot, input.incomingWorkspace)) {
    return { kind: "create", adoptWorkspace: !input.currentRoot };
  }
  return { kind: "newWindow" };
}
