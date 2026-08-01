/**
 * Workspace Session Persistence
 *
 * Purpose: Persists the current window's session before close — open tab paths
 *   into the workspace config file, and the two-pane split layout (#1081) into
 *   localStorage — so both are restored on reopen.
 *
 * WI-6R (rail mode): EACH workspace instance's root receives ONLY its own
 * tabs, via a per-root read-modify-write against the ON-DISK config (never
 * the single in-memory legacy config — that was the cross-contamination bug
 * where every window tab landed in whichever root happened to be legacy).
 * Loose tabs belong to no workspace config; browser tabs persist via the
 * window session (WI-8.2), not workspace configs. Failures are isolated per
 * root. Rail off keeps the original single-root behavior verbatim.
 *
 * Split layouts (WI-10.3): the ACTIVE instance persists its live split; a
 * HIDDEN instance persists its stashed snapshot — each keyed by its own root.
 *
 * @coordinates-with workspaceStore.ts — reads rootPath and config (rail off)
 * @coordinates-with useWindowClose.ts — calls persistWorkspaceSession before close
 * @coordinates-with services/persistence/splitLayoutPersistence.ts — saves split layout
 * @coordinates-with workspaceOwnershipKernel.ts — per-instance tab ownership
 * @module services/workspaces/workspaceSession
 */
import { invoke } from "@tauri-apps/api/core";
import { workspaceError } from "@/utils/debug";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { tabFilePath } from "@/stores/tabStoreTypes";
import { usePaneStore, type WindowSplit } from "@/stores/paneStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { saveSplitLayout, type SplitLayoutConfig } from "@/services/persistence/splitLayoutPersistence";
import { serializeSessionTabs, documentPathsOf } from "@/services/persistence/sessionTabs";
import { saveWindowBrowserSession } from "@/services/persistence/windowBrowserSession";
import { getRuntimePlatform } from "@/utils/platform";
import { normalizePathForCompare } from "@/utils/paths/pathComparison";
import { contextKindOf, partitionWindowTabs } from "./workspaceOwnershipKernel";
import { orderedWindowInstances } from "./workspaceContextOwnership";
import { isValidWorkspaceConfig } from "./workspaceConfigGuard";

/** Serialize a split into its persisted path-based form (both panes saved). */
function splitLayoutOf(split: WindowSplit | null, tabs: Tab[]): SplitLayoutConfig | null {
  if (!split?.enabled || !split.primaryTabId || !split.secondaryTabId) return null;
  const priTab = tabs.find((t) => t.id === split.primaryTabId);
  const secTab = tabs.find((t) => t.id === split.secondaryTabId);
  const priPath = priTab ? tabFilePath(priTab) : null;
  const secPath = secTab ? tabFilePath(secTab) : null;
  // Both panes need a saved path — an untitled pane can't be restored.
  if (!priPath || !secPath || priPath === secPath) return null;
  return {
    orientation: split.orientation,
    fraction: split.fraction,
    syncScroll: split.syncScroll,
    primaryPath: priPath,
    secondaryPath: secPath,
  };
}

/** WI-6R: per-instance session write — each root gets only its own tabs. */
async function persistRailWorkspaceSessions(windowLabel: string): Promise<void> {
  const instances = orderedWindowInstances(windowLabel);
  const workspaceInstances = instances.filter(
    (instance) => contextKindOf(instance) === "workspace" && instance.rootPath,
  );
  if (workspaceInstances.length === 0) return;

  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const activeId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  const partition = partitionWindowTabs(tabs, instances, activeId);

  // Audit R2-F10: group instances by canonical root identity and UNION their
  // owned tabs — two same-root instances (corrupt restore) must not lose the
  // second one's tabs, and a duplicated root must not double-write its config.
  // The key is the NORMALIZED root path: the config write is keyed by the
  // on-disk root, so path identity (platform-aware) is the canonical grouping,
  // regardless of whether the instances carry matching rootIds.
  const platform = getRuntimePlatform();
  const byRoot = new Map<string, { rootPath: string; instances: typeof workspaceInstances }>();
  for (const instance of workspaceInstances) {
    const rootKey = normalizePathForCompare(instance.rootPath!, platform);
    const group = byRoot.get(rootKey) ?? { rootPath: instance.rootPath!, instances: [] };
    group.instances.push(instance);
    byRoot.set(rootKey, group);
  }

  for (const group of byRoot.values()) {
    const { rootPath } = group;
    // Split layout comes from the ACTIVE member when the group contains it —
    // its live split is the state the user sees; a stash would be stale.
    const instance =
      group.instances.find((member) => member.workspaceInstanceId === activeId) ??
      group.instances[0];
    const ownedIds = new Set(
      group.instances.flatMap(
        (member) => partition.byScope.get(member.workspaceInstanceId) ?? [],
      ),
    );
    const ownedTabs = tabs.filter((tab) => ownedIds.has(tab.id));

    // Split layout: live split for the active instance, stash for hidden ones.
    const split =
      instance.workspaceInstanceId === activeId
        ? usePaneStore.getState().byWindow[windowLabel] ?? null
        : useWorkspacePaneLayoutsStore.getState().getPaneLayout(instance.workspaceInstanceId);
    saveSplitLayout(rootPath, splitLayoutOf(split, ownedTabs));

    try {
      const disk = await invoke<WorkspaceConfig | null>("read_workspace_config", { rootPath });
      if (disk !== null && !isValidWorkspaceConfig(disk)) {
        // Never clobber a config we can't parse — skip this root.
        workspaceError("Malformed on-disk config; skipping session write for", rootPath);
        continue;
      }
      const base: WorkspaceConfig = disk ?? {
        version: 1,
        excludeFolders: [],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
      };
      await invoke("write_workspace_config", {
        rootPath,
        config: {
          ...base,
          lastOpenTabs: documentPathsOf(ownedTabs),
          sessionTabs: serializeSessionTabs(ownedTabs),
        },
      });
    } catch (error) {
      // Per-root isolation: one root's disk trouble must not lose the others.
      workspaceError("Failed to save workspace session for", rootPath, error);
    }
  }
}

/**
 * Persist the current window's open tabs into workspace config.
 */
export async function persistWorkspaceSession(windowLabel: string): Promise<void> {
  // WI-8.2: browser pages are window-global — persist the window's
  // restore-human pages regardless of workspace mode or rail state.
  saveWindowBrowserSession(windowLabel, useTabStore.getState().getTabsByWindow(windowLabel));

  if (isWorkspaceRailEnabled()) {
    await persistRailWorkspaceSessions(windowLabel);
    return;
  }

  const { rootPath, config, isWorkspaceMode } = useWorkspaceStore.getState();

  if (!isWorkspaceMode || !rootPath || !config) {
    return;
  }

  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  // Legacy field: document paths only, so a downgraded (older) VMark still
  // restores document tabs and simply skips browser tabs (WI-1.1 / R1).
  const openPaths = documentPathsOf(tabs);

  // Persist the two-pane split layout (#1081) to localStorage by root path —
  // per-machine UI state, not part of the shared workspace config.
  saveSplitLayout(
    rootPath,
    splitLayoutOf(usePaneStore.getState().byWindow[windowLabel] ?? null, tabs),
  );

  // New field: full ordered tab list incl. browser tabs (WI-1.1). New builds
  // prefer this; old builds ignore the unknown field (serde default).
  const updatedConfig = {
    ...config,
    lastOpenTabs: openPaths,
    sessionTabs: serializeSessionTabs(tabs),
  };

  try {
    await invoke("write_workspace_config", {
      rootPath,
      config: updatedConfig,
    });
  } catch (error) {
    workspaceError("Failed to save workspace config:", error);
  }
}
