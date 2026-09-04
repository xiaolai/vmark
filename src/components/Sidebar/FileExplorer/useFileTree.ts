/**
 * useFileTree
 *
 * Purpose: Loads and maintains a recursive file tree for a workspace directory.
 * Listens for file system change events to auto-refresh the tree when files are
 * created, renamed, or deleted.
 *
 * Key decisions:
 *   - ONE listing per refresh (#1357): `list_directory_tree` walks the whole tree
 *     in Rust, off the IPC thread, with the always-skipped directories (the same
 *     floor the workspace search applies), the workspace's `excludeFolders` and —
 *     unless hidden entries are shown — hidden directories pruned before they are
 *     read. The hook used to recurse here with one IPC round trip per directory,
 *     serially awaited: seconds per scan on a large root, and that slowness was
 *     the fuel of the rescan loop below.
 *   - WHEN to re-list is `rescanScheduler`'s decision, not this hook's: events are
 *     debounced, a stream that never goes quiet still gets a scan within a bound,
 *     and a scan that saw events while it ran is followed by a rest that doubles
 *     while the churn continues. The previous policy — rescan per event batch,
 *     and rescan again at once if anything arrived meanwhile — restarted back to
 *     back for as long as something in the workspace kept writing (36 minutes at
 *     ~20 full scans a minute in the report), one core pinned.
 *   - By default only includes markdown files (via mdFilter). When showAllFiles
 *     is enabled, all file types are shown — non-markdown files open with the
 *     system default app. The file-type filter stays client-side: it is a
 *     registry-driven predicate; Rust prunes directories only.
 *   - Node labels come from formatFileDisplayName — the same formatter the tab
 *     strip uses, so the two never disagree. The name on disk by default, since
 *     a hidden extension turned `requirements.txt` into an unexplained
 *     `requirements` (#1224). showAllFiles decides what is LISTED, not how a
 *     listed name is spelled.
 *   - Request ID pattern (requestIdRef) prevents stale async responses from
 *     overwriting fresher tree data.
 *   - Watch events are scoped by watchId (window label) to prevent cross-window
 *     interference when multiple windows watch the same directory.
 *   - Folders are always included (even if empty) so users can right-click to
 *     add files into them. An unreadable subfolder renders empty and is logged;
 *     an unreadable ROOT is an error, never an empty workspace (#1224).
 *   - Window-focus refresh is a defensive safety net: macOS FSEvents (and
 *     equivalent native watchers on other platforms) occasionally miss
 *     externally-created files — Finder operations, externally-mounted
 *     volumes, paths reached through symlinks. Re-listing the tree on focus
 *     guarantees the user sees external changes the moment they switch
 *     back to VMark, regardless of whether fs:changed fired.
 *
 * @coordinates-with FileExplorer.tsx — consumes the tree data and refresh callback
 * @coordinates-with components/Sidebar/FileExplorer/rescanScheduler.ts — decides when a scan runs
 * @coordinates-with src-tauri/src/file_tree_walk.rs — the one-call listing this invokes
 * @coordinates-with services/workspaceEvents/subscribeWorkspaceEvents.ts — the shared, scoped fs-event source it subscribes to
 * @module components/Sidebar/FileExplorer/useFileTree
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { FileNode, TreeEntry, TreeListing } from "./types";
import { subscribeWorkspaceEvents } from "@/services/workspaceEvents/subscribeWorkspaceEvents";
import {
  isMarkdownFileName,
  isSupportedFileName,
  isVMarkFileName,
} from "@/utils/dropPaths";
import { isWorkflowYamlSurfaceEnabled } from "@/services/featureFlags/workflowFeatureFlag";
import { shouldIncludeEntry, type FileTreeFilterOptions } from "./fileTreeFilters";
import { createRescanScheduler, type RescanScheduler } from "./rescanScheduler";
import { formatFileDisplayName } from "@/utils/displayFileName";
import { fileExplorerError } from "@/utils/debug";
import { commandErrorMessage } from "@/services/commands/commandError";

type LoadOptions = FileTreeFilterOptions & { showExtensions: boolean };

/** The whole tree under `rootPath`, in ONE round trip. THROWS when the root cannot be read. */
async function listDirectoryTree(rootPath: string, options: LoadOptions): Promise<TreeListing> {
  return invoke<TreeListing>("list_directory_tree", {
    path: rootPath,
    options: { excludeFolders: options.excludeFolders, showHidden: options.showHidden },
  });
}

/** Folders first, then by name. */
function byFolderThenName(a: FileNode, b: FileNode): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * The listed entries as tree nodes: the client-side file filter applied at
 * every level, folders always kept (so users can right-click to add files into
 * them), an unreadable subfolder logged and shown empty — one locked folder deep
 * in a workspace must not blank the tree (the #1224 failure mode is the ROOT,
 * handled in loadTree).
 */
function toNodes(entries: TreeEntry[], options: LoadOptions): FileNode[] {
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (!shouldIncludeEntry(entry, options)) continue;
    if (entry.isDirectory) {
      if (entry.unreadable) fileExplorerError(" Failed to read directory:", entry.path);
      nodes.push({ id: entry.path, name: entry.name, isFolder: true, children: toNodes(entry.children ?? [], options) });
    } else {
      nodes.push({ id: entry.path, name: formatFileDisplayName(entry.name, options.showExtensions), isFolder: false });
    }
  }
  return nodes.sort(byFolderThenName);
}

// Phase 1B: file explorer surfaces every registered format. The
// workflow + markdown-only narrowing of the legacy filter is preserved as a
// fallback when the registry isn't bootstrapped. WI-19: either workflow
// feature makes a standalone .yml a VMark file, so the fallback ORs them —
// gating on the engine alone would hide workflow files from a viewer-only user.
const mdFilter = (name: string, isFolder: boolean): boolean => {
  if (isFolder) return true;
  if (isSupportedFileName(name)) return true;
  if (isWorkflowYamlSurfaceEnabled()) return isVMarkFileName(name);
  return isMarkdownFileName(name);
};

interface UseFileTreeOptions {
  excludeFolders?: string[];
  showHidden?: boolean;
  showAllFiles?: boolean;
  /** Show each file's real name, extension included (#1224). Default true. */
  showExtensions?: boolean;
  /** Window label used as watchId for scoped file system events */
  watchId?: string;
}

/** Hook that loads and maintains a recursive file tree for a workspace directory with fs-event auto-refresh. */
export function useFileTree(
  rootPath: string | null,
  options: UseFileTreeOptions = {}
) {
  const {
    excludeFolders = [],
    showHidden = false,
    showAllFiles = false,
    showExtensions = true,
    watchId = "main",
  } = options;
  const [tree, setTree] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The listing hit the walker's node or depth bound: the tree shown is partial. */
  const [truncated, setTruncated] = useState(false);
  const requestIdRef = useRef(0);
  const schedulerRef = useRef<RescanScheduler | null>(null);
  // JSON, not join(","): ["a,b"] and ["a","b"] flatten to the same comma string,
  // so a switch between them kept the previous loader and its exclusions.
  const excludeFoldersKey = JSON.stringify(excludeFolders);

  /** ONE scan. Single flight and timing belong to the scheduler, never here. */
  const loadTree = useCallback(async () => {
    // Bump the request id even when clearing: a listing already in flight must
    // not repopulate a tree the user just closed (or an unmounted hook).
    const currentRequestId = ++requestIdRef.current;
    if (!rootPath) {
      setTree([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const loadOptions: LoadOptions = {
        filter: mdFilter,
        excludeFolders,
        showHidden,
        showAllFiles,
        showExtensions,
      };
      const listing = await listDirectoryTree(rootPath, loadOptions);
      if (listing.truncated) fileExplorerError(" Tree listing truncated at the walker's bound:", rootPath);
      if (currentRequestId === requestIdRef.current) {
        setTree(toNodes(listing.entries, loadOptions));
        setTruncated(listing.truncated);
        setError(null);
      }
    } catch (err) {
      // The ROOT could not be read. Reporting an empty tree here is the lie
      // that made #1224 look like a rendering bug.
      fileExplorerError(" Failed to load tree:", err);
      if (currentRequestId === requestIdRef.current) {
        setTree([]);
        setTruncated(false);
        setError(commandErrorMessage(err));
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- excludeFoldersKey is stable serialization
  }, [rootPath, excludeFoldersKey, showHidden, showAllFiles, showExtensions]);

  // Load tree and setup watcher when rootPath changes
  useEffect(() => {
    if (!rootPath) {
      // Invalidate anything in flight: a listing started for the workspace we
      // just closed must not repopulate the cleared tree.
      requestIdRef.current += 1;
      // Legitimate: clears the tree as part of an async load + fs-watcher setup
      // keyed on rootPath, not derivable during render (#1063).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTree([]);
      setError(null);
      setTruncated(false);
      return;
    }

    // The scheduler owns single flight, debounce and back-off (#1357); one per
    // (root, options) so a switch starts from a clean slate.
    const scheduler = createRescanScheduler(loadTree);
    schedulerRef.current = scheduler;
    void scheduler.refreshNow();

    // Subscribe to the shared, already-scoped workspace event stream: any
    // in-scope batch (create / delete / rename / real modify) asks for a scan.
    // Scoping + self-write filtering + no-op suppression are done by the source;
    // coalescing and pacing by the scheduler, so this stays a one-liner.
    const unsubscribe = subscribeWorkspaceEvents(watchId, () => {
      scheduler.request();
    });

    return () => {
      // Unmount, or a switch to another workspace: the same invalidation.
      requestIdRef.current += 1;
      unsubscribe();
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [rootPath, loadTree, watchId]);

  // Defensive safety net (see header `Key decisions`): refresh the tree
  // whenever the window regains focus. This catches externally-created
  // files when the native watcher misses an event.
  useEffect(() => {
    if (!rootPath) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    getCurrentWebviewWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void schedulerRef.current?.refreshNow();
      })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch((error: unknown) => {
        fileExplorerError(" Failed to listen for window focus:",
          commandErrorMessage(error));
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [rootPath]);

  /** Manual refresh: scan now (coalesced with a running scan), resolved once it has run. */
  const refresh = useCallback(
    () => schedulerRef.current?.refreshNow() ?? loadTree(),
    [loadTree],
  );

  return { tree, isLoading, error, truncated, refresh };
}
