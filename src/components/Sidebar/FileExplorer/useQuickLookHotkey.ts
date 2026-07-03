/**
 * useQuickLookHotkey — Finder-style spacebar preview trigger for the file tree.
 *
 * Purpose: Returns an `onKeyDown` handler for the FileExplorer tree container.
 *   When Space is pressed with a non-folder node selected, it opens the Quick
 *   Look overlay for that file's absolute path and calls preventDefault so
 *   arborist doesn't also act on the key. Folder / empty selections and every
 *   other key fall through untouched (Enter, F2, arrows keep working).
 *
 * Opening-for-all: any selected file opens the overlay; MediaView degrades
 *   gracefully for non-media types, matching Finder's behavior.
 *
 * Guards: only an unmodified Space triggers (modified Space belongs to other
 *   shortcuts), and Space is ignored when it targets a text input / textarea /
 *   contenteditable — so typing a space in the inline rename field is untouched.
 *
 * @coordinates-with stores/quickLookStore.ts — open()
 * @coordinates-with FileExplorer.tsx — consumes the returned handler
 * @module components/Sidebar/FileExplorer/useQuickLookHotkey
 */

import { useCallback, type KeyboardEvent, type RefObject } from "react";
import type { TreeApi } from "react-arborist";
import { useQuickLookStore } from "@/stores/quickLookStore";
import type { FileNode } from "./types";

/** Build the tree-container keydown handler that opens Quick Look on Space. */
export function useQuickLookHotkey(
  treeRef: RefObject<TreeApi<FileNode> | null>,
) {
  return useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      // Only an unmodified Space is the Quick Look trigger; Shift/Ctrl/Meta/Alt
      // Space belongs to other shortcuts and must fall through untouched.
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      // Never hijack Space while the user is typing — the inline rename input,
      // any text field, or a contenteditable region must receive the space.
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const tree = treeRef.current;
      const selected = tree?.selectedNodes[0];
      // No selection, or a folder → let arborist handle Space normally.
      if (!selected || selected.data.isFolder) return;
      e.preventDefault();
      // Ordered navigable siblings = every visible file (folders excluded), in
      // display order, so the overlay's arrow keys walk the tree like Finder.
      const siblings = (tree?.visibleNodes ?? [])
        .filter((n) => !n.data.isFolder)
        .map((n) => n.data.id);
      useQuickLookStore.getState().open(selected.data.id, siblings);
    },
    [treeRef],
  );
}
