import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { dragDropError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";
import { resolveWorkspaceRootForExternalFile } from "@/utils/openPolicy";

export async function openDroppedPathsInLegacyWindows(paths: string[]): Promise<void> {
  const groups = new Map<string, string[]>();
  const rootless: string[] = [];

  for (const path of paths) {
    const root = resolveWorkspaceRootForExternalFile(path);
    if (root) {
      const existing = groups.get(root) ?? [];
      existing.push(path);
      groups.set(root, existing);
    } else {
      rootless.push(path);
    }
  }

  for (const [workspaceRoot, filePaths] of groups.entries()) {
    try {
      await invoke("open_workspace_with_files_in_new_window", {
        workspaceRoot,
        filePaths,
      });
    } catch (error) {
      dragDropError("Failed to open workspace in new window:", error);
      toast.error(i18n.t("dialog:toast.failedToOpenFilesInNewWindow"));
    }
  }

  for (const path of rootless) {
    try {
      await invoke("open_file_in_new_window", { path });
    } catch (error) {
      dragDropError("Failed to open file in new window:", error);
      const filename = getFileName(path) || path;
      toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
    }
  }
}
