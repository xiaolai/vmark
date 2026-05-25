/**
 * useWorkspace — single read API for workspace state (ADR-008).
 *
 * Aggregates `tabStore`, `workspaceStore`, `recentFilesStore`, and
 * `recentWorkspacesStore` into one stable surface. UI components depend
 * on this hook; the underlying stores remain free to reshape without
 * coordinated UI changes.
 *
 * **Mutations are out of scope here.** Until ADR-012's CommandBus
 * lands, mutations continue to call store actions directly. Once the
 * bus exists, the pattern becomes `commandBus.execute("workspace.*", …)`.
 *
 * Adoption is incremental — existing components keep importing
 * individual stores; new code (and migrated components) read from
 * `useWorkspace()`.
 *
 * @module workspace/useWorkspace
 */

import { useContext } from "react";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useRecentFilesStore, type RecentFile } from "@/stores/workspaceStore";
import { useRecentWorkspacesStore, type RecentWorkspace } from "@/stores/workspaceStore";
import { WindowContext } from "@/contexts/WindowContext";

export interface WorkspaceView {
  /** Absolute path of the currently-open workspace folder, or null. */
  rootPath: string | null;
  /** True when the user opened a folder via "Open Workspace…". */
  isWorkspaceMode: boolean;
  /** Workspace config for the current window (folder path, settings). */
  config: WorkspaceConfig | null;

  /** Open tabs in the current window. */
  openTabs: Tab[];
  /** ID of the currently active tab in the current window. */
  activeTabId: string | null;
  /** The active tab, if any. */
  activeTab: Tab | null;

  /** Recently opened files across windows. */
  recentFiles: RecentFile[];
  /** Recently opened workspaces (folders) across windows. */
  recentWorkspaces: RecentWorkspace[];
}

/**
 * Read the current workspace view. Subscribes to the underlying stores;
 * a re-render fires when any read field changes.
 *
 * Mutations: call the store actions or the command bus directly.
 */
const EMPTY_TABS: Tab[] = [];

export function useWorkspace(): WorkspaceView {
  // Tolerate missing WindowProvider — tests that render isolated UI
  // surfaces shouldn't be forced to wrap in WindowProvider. Defaults
  // to "main" which matches the single-window code path.
  const ctx = useContext(WindowContext);
  const windowLabel = ctx?.windowLabel ?? "main";

  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const isWorkspaceMode = useWorkspaceStore((s) => s.isWorkspaceMode);
  const config = useWorkspaceStore((s) => s.config);

  // Stable empty-array reference avoids infinite re-render when tabs are absent.
  const openTabs = useTabStore((s) => s.tabs[windowLabel] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const activeTab = openTabs.find((t: Tab) => t.id === activeTabId) ?? null;

  const recentFiles = useRecentFilesStore((s) => s.files);
  const recentWorkspaces = useRecentWorkspacesStore((s) => s.workspaces);

  return {
    rootPath,
    isWorkspaceMode,
    config,
    openTabs,
    activeTabId,
    activeTab,
    recentFiles,
    recentWorkspaces,
  };
}
