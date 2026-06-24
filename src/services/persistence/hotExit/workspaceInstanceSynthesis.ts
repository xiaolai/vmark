/**
 * Shared legacy workspace-instance synthesis.
 *
 * Both the v4 -> v5 migration (`schemaMigrationWorkspaceContexts`) and the
 * runtime restore path (`workspaceInstanceRestoreData`) need to derive rail
 * contexts from a legacy window that has no serialized instances. They must
 * agree exactly — in particular, neither may DROP workspace tabs when the
 * workspace root identity cannot be created (blank / unusable root path).
 * Earlier the two copies diverged: migration kept the tabs with a fallback
 * rootId while restore silently dropped them. This single pure synthesizer is
 * the source of truth for that behavior.
 *
 * @module services/persistence/hotExit/workspaceInstanceSynthesis
 */
import type { WorkspaceInstanceRecord } from "@/stores/workspaceInstancesStore";
import { createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { isWithinRoot } from "@/utils/paths";
import type { TabState } from "./types";

/** Minimal view of a window needed to synthesize legacy instances. */
export interface LegacyWindowSynthesisInput {
  windowLabel: string;
  activeTabId: string | null;
  tabs: TabState[];
}

/**
 * Synthesize workspace + loose rail contexts from a legacy window's tabs.
 *
 * - Tabs whose path is inside `legacyWorkspaceRoot` form a single `workspace`
 *   context; the rest (including untitled tabs) form a `loose` context.
 * - When the root identity cannot be created (blank / unusable path), the
 *   workspace context is still produced with a deterministic fallback rootId
 *   and displayName so the tabs are never dropped.
 * - Returns `[]` when the window has no tabs.
 */
export function synthesizeLegacyWindowInstances(
  window: LegacyWindowSynthesisInput,
  legacyWorkspaceRoot: string | null,
): WorkspaceInstanceRecord[] {
  if (window.tabs.length === 0) return [];

  const workspaceTabs: TabState[] = [];
  const looseTabs: TabState[] = [];
  for (const tab of window.tabs) {
    if (
      legacyWorkspaceRoot &&
      tab.file_path &&
      isWithinRoot(legacyWorkspaceRoot, tab.file_path)
    ) {
      workspaceTabs.push(tab);
    } else {
      looseTabs.push(tab);
    }
  }

  const result: WorkspaceInstanceRecord[] = [];
  if (legacyWorkspaceRoot && workspaceTabs.length > 0) {
    result.push(
      synthesizeWorkspaceContext(window, legacyWorkspaceRoot, workspaceTabs),
    );
  }
  if (looseTabs.length > 0) {
    result.push(synthesizeLooseContext(window, looseTabs));
  }
  return result;
}

function synthesizeWorkspaceContext(
  window: LegacyWindowSynthesisInput,
  legacyWorkspaceRoot: string,
  workspaceTabs: TabState[],
): WorkspaceInstanceRecord {
  const root = createWorkspaceRootIdentity(legacyWorkspaceRoot, { platform: "macos" });
  return {
    workspaceInstanceId: `wsi-legacy-${window.windowLabel}-workspace`,
    kind: "workspace",
    // Fallback identity preserves the tabs even when the root path is
    // unusable; the deterministic id mirrors createWorkspaceRootIdentity's
    // path-id format so it stays stable across migration and restore.
    rootId: root.ok ? root.root.rootId : `path:macos:${legacyWorkspaceRoot}`,
    rootPath: legacyWorkspaceRoot,
    displayName: root.ok ? root.root.displayName : legacyWorkspaceRoot,
    ownerWindowLabel: window.windowLabel,
    createdFrom: "restore",
    activeTabId: activeTabInList(window.activeTabId, workspaceTabs),
    tabIds: workspaceTabs.map((tab) => tab.id),
    closedTabIds: [],
    unavailableRoot: false,
  };
}

function synthesizeLooseContext(
  window: LegacyWindowSynthesisInput,
  looseTabs: TabState[],
): WorkspaceInstanceRecord {
  return {
    workspaceInstanceId: `wsi-legacy-${window.windowLabel}-loose`,
    kind: "loose",
    rootId: null,
    rootPath: null,
    displayName: "Loose Files",
    ownerWindowLabel: window.windowLabel,
    createdFrom: "restore",
    activeTabId: activeTabInList(window.activeTabId, looseTabs),
    tabIds: looseTabs.map((tab) => tab.id),
    closedTabIds: [],
    unavailableRoot: false,
  };
}

function activeTabInList(activeTabId: string | null, tabs: TabState[]): string | null {
  if (!activeTabId) return null;
  return tabs.some((tab) => tab.id === activeTabId) ? activeTabId : null;
}
