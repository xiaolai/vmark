/**
 * useTitleBarRename
 *
 * Purpose: Hook that performs file rename operations triggered from the title
 * bar by delegating to the shared rename service and mapping its outcome to
 * the boolean the inline rename input expects.
 *
 * Key decisions:
 *   - Re-entry guard (isRenamingRef) prevents duplicate rename operations from
 *     rapid double-clicks or keyboard repeat.
 *   - Delegates to services/persistence/renameFile. Extension preservation is
 *     the CALLER's call: pass `preserveExtension: false` when the editor
 *     showed the extension, so deleting it renames the file instead of being
 *     silently undone (#1224). Either way the service refuses to overwrite an
 *     existing target.
 *   - The open document (and any other tab at the old path) is re-pointed by
 *     the service's path reconciliation — no direct setFilePath call here.
 *   - Failures return false so the title bar stays in edit mode.
 *
 * @coordinates-with TitleBar.tsx — calls renameFile on double-click confirm
 * @coordinates-with services/persistence/renameFile.ts — shared rename core
 * @module components/TitleBar/useTitleBarRename
 */
import { useState, useCallback, useRef } from "react";
import { renameFile as renameFileOnDisk } from "@/services/persistence/renameFile";
import { titleBarWarn, fileOpsError } from "@/utils/debug";

/** Hook that performs file rename operations triggered from the title bar. */
export function useTitleBarRename() {
  const [isRenaming, setIsRenaming] = useState(false);
  const isRenamingRef = useRef(false);

  const renameFile = useCallback(
    async (
      oldPath: string,
      newName: string,
      options: { preserveExtension?: boolean } = {},
    ): Promise<boolean> => {
      // Guard against re-entry
      if (isRenamingRef.current) return false;
      isRenamingRef.current = true;
      setIsRenaming(true);

      try {
        // The title bar only ever renames the open document — always a file.
        const outcome = await renameFileOnDisk(oldPath, newName, {
          isFolder: false,
          preserveExtension: options.preserveExtension ?? true,
        });
        switch (outcome.status) {
          case "renamed":
          case "unchanged":
            return true;
          case "exists":
            titleBarWarn("Target file already exists:", outcome.name);
            return false;
          case "error":
            fileOpsError("Failed to rename file:", outcome.error);
            return false;
        }
      } finally {
        isRenamingRef.current = false;
        setIsRenaming(false);
      }
    },
    []
  );

  return { renameFile, isRenaming };
}
