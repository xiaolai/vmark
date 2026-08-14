/**
 * useFileTree
 *
 * Purpose: Loads and maintains a recursive file tree for a workspace directory.
 * Listens for file system change events to auto-refresh the tree when files are
 * created, renamed, or deleted.
 *
 * Key decisions:
 *   - By default only includes markdown files (via mdFilter). When showAllFiles
 *     is enabled, all file types are shown — non-markdown files open with the
 *     system default app.
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
 *     add files into them.
 *   - Window-focus refresh is a defensive safety net: macOS FSEvents (and
 *     equivalent native watchers on other platforms) occasionally miss
 *     externally-created files — Finder operations, externally-mounted
 *     volumes, paths reached through symlinks. Re-listing the tree on focus
 *     guarantees the user sees external changes the moment they switch
 *     back to VMark, regardless of whether fs:changed fired.
 *
 * @coordinates-with FileExplorer.tsx — consumes the tree data and refresh callback
 * @coordinates-with services/workspaceEvents/subscribeWorkspaceEvents.ts — the shared, scoped fs-event source it subscribes to
 * @module components/Sidebar/FileExplorer/useFileTree
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { FileNode, DirectoryEntry } from "./types";
import { subscribeWorkspaceEvents } from "@/services/workspaceEvents/subscribeWorkspaceEvents";
import {
  isMarkdownFileName,
  isSupportedFileName,
  isVMarkFileName,
} from "@/utils/dropPaths";
import { isWorkflowYamlSurfaceEnabled } from "@/services/featureFlags/workflowFeatureFlag";
import { shouldIncludeEntry, type FileTreeFilterOptions } from "./fileTreeFilters";
import { formatFileDisplayName } from "@/utils/displayFileName";
import { fileExplorerError } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

type LoadOptions = FileTreeFilterOptions & { showExtensions: boolean };

async function listDirectoryEntries(dirPath: string): Promise<DirectoryEntry[]> {
  return invoke<DirectoryEntry[]>("list_directory_entries", { path: dirPath });
}

/** One directory entry as a tree node; folders carry their loaded children. */
function toNode(entry: DirectoryEntry, options: LoadOptions, children: FileNode[]): FileNode {
  return entry.isDirectory
    ? { id: entry.path, name: entry.name, isFolder: true, children }
    : {
        id: entry.path,
        name: formatFileDisplayName(entry.name, options.showExtensions),
        isFolder: false,
      };
}

/** Folders first, then by name. */
function byFolderThenName(a: FileNode, b: FileNode): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * List one directory and its descendants. THROWS when this directory cannot be
 * read — the caller decides what that means.
 */
async function loadDirectory(dirPath: string, options: LoadOptions): Promise<FileNode[]> {
  const entries = await listDirectoryEntries(dirPath);
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (!shouldIncludeEntry(entry, options)) continue;
    // Always include folders so users can right-click to add files into them.
    const children = entry.isDirectory ? await loadSubtree(entry.path, options) : [];
    nodes.push(toNode(entry, options, children));
  }
  return nodes.sort(byFolderThenName);
}

/**
 * A SUBDIRECTORY's subtree: one unreadable folder deep in a workspace must not
 * blank the whole tree, so its failure is logged and it renders as empty. The
 * ROOT is different — see loadTree, which surfaces that as an error rather than
 * telling the user their workspace is empty (the #1224 failure mode).
 */
async function loadSubtree(dirPath: string, options: LoadOptions): Promise<FileNode[]> {
  try {
    return await loadDirectory(dirPath, options);
  } catch (error) {
    fileExplorerError(" Failed to read directory:", dirPath, error);
    return [];
  }
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
  const requestIdRef = useRef(0);
  // In-flight guard: a focus event and an fs batch arriving together used to
  // launch two full recursive scans of the same workspace. One runs; a request
  // that arrives meanwhile sets `rerunPendingRef` and is coalesced into a
  // single follow-up pass.
  const inFlightRef = useRef(false);
  const rerunPendingRef = useRef(false);
  // JSON, not join(","): ["a,b"] and ["a","b"] flatten to the same comma string,
  // so a switch between them kept the previous loader and its exclusions.
  const excludeFoldersKey = JSON.stringify(excludeFolders);

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
    if (inFlightRef.current) {
      rerunPendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setIsLoading(true);

    try {
      const loadOptions: LoadOptions = {
        filter: mdFilter,
        excludeFolders,
        showHidden,
        showAllFiles,
        showExtensions,
      };
      const nodes = await loadDirectory(rootPath, loadOptions);
      if (currentRequestId === requestIdRef.current) {
        setTree(nodes);
        setError(null);
      }
    } catch (err) {
      // The ROOT could not be read. Reporting an empty tree here is the lie
      // that made #1224 look like a rendering bug.
      fileExplorerError(" Failed to load tree:", err);
      if (currentRequestId === requestIdRef.current) {
        setTree([]);
        setError(errorMessage(err));
      }
    } finally {
      inFlightRef.current = false;
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
      if (rerunPendingRef.current) {
        rerunPendingRef.current = false;
        void loadTree();
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
      return;
    }

    void loadTree();

    // Subscribe to the shared, already-scoped workspace event stream: any
    // in-scope batch (create / delete / rename / real modify) triggers a
    // reload. Scoping + self-write filtering + no-op suppression are done by
    // the source, so this stays a one-liner.
    const unsubscribe = subscribeWorkspaceEvents(watchId, () => {
      void loadTree();
    });

    return () => {
      // Unmount, or a switch to another workspace: the same invalidation.
      requestIdRef.current += 1;
      unsubscribe();
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
        if (focused) void loadTree();
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
          errorMessage(error));
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [rootPath, loadTree]);

  return { tree, isLoading, error, refresh: loadTree };
}
