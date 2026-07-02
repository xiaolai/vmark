/**
 * TabRenameInput
 *
 * Purpose: Inline rename editor shown in place of a tab's title when the tab
 * is in rename mode. Mirrors the File Explorer's node-rename UX (auto-select
 * the filename without extension, Enter commits, Escape/blur cancels) and
 * delegates the actual rename to the shared `renameFile` service.
 *
 * Key decisions:
 *   - Prefills from the raw basename (with extension) so the user edits the
 *     real filename; `renameFile` re-applies `.md` if omitted.
 *   - A submit guard prevents Enter + blur double-submitting the same value.
 *   - On success the tab title updates via path reconciliation (renameFile);
 *     failures surface a toast. Either way the editor closes.
 *
 * @coordinates-with services/persistence/renameFile.ts — performs the rename
 * @coordinates-with stores/tabRenameStore.ts — owns the editing flag
 * @coordinates-with Tab.tsx — renders this when the tab is being renamed
 * @module components/Tabs/TabRenameInput
 */
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { renameFile } from "@/services/persistence/renameFile";
import { useTabRenameStore } from "@/stores/tabRenameStore";
import { showError, FileErrors } from "@/services/dialogs/errorDialog";
import { tabContextError } from "@/utils/debug";

interface TabRenameInputProps {
  /** Absolute path of the file backing this tab. */
  filePath: string;
  /** Raw filename (basename, with extension) to prefill and edit. */
  fileName: string;
}

/** Inline text editor for renaming a tab's backing file. */
export function TabRenameInput({ filePath, fileName }: TabRenameInputProps) {
  const { t } = useTranslation("common");
  const submittedRef = useRef(false);

  const finish = useCallback(() => {
    useTabRenameStore.getState().stopRename();
  }, []);

  const submit = useCallback(
    async (nextName: string) => {
      if (submittedRef.current) return;
      submittedRef.current = true;

      const trimmed = nextName.trim();
      if (!trimmed || trimmed === fileName) {
        finish();
        return;
      }

      const outcome = await renameFile(filePath, trimmed);
      if (outcome.status === "exists") {
        await showError(
          outcome.isFile
            ? FileErrors.fileExists(outcome.name)
            : FileErrors.folderExists(outcome.name),
        );
      } else if (outcome.status === "error") {
        tabContextError(" Tab rename failed:", outcome.error);
        await showError(FileErrors.renameFailed(trimmed));
      }
      finish();
    },
    [fileName, filePath, finish],
  );

  return (
    <input
      type="text"
      className="tab-title-input"
      aria-label={t("tabMenu.rename")}
      defaultValue={fileName}
      autoFocus
      // Keep clicks/drag on the editor from activating or reordering the tab.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={(e) => {
        const input = e.target;
        const dotIndex = input.value.lastIndexOf(".");
        if (dotIndex > 0) {
          input.setSelectionRange(0, dotIndex);
        } else {
          input.select();
        }
      }}
      onBlur={(e) => {
        void submit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (isImeKeyEvent(e.nativeEvent)) return;
        if (e.key === "Escape") {
          e.preventDefault();
          submittedRef.current = true;
          finish();
        } else if (e.key === "Enter") {
          e.preventDefault();
          void submit(e.currentTarget.value);
        }
      }}
    />
  );
}
