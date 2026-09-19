/**
 * openWithDefaultApp — hand a file VMark does not open itself to the OS.
 *
 * Purpose: ONE door for "this is not a VMark document, let the system handle
 * it", shared by the file explorer's activate/Open and by Quick Open (#1428).
 * Both surfaces now list the same set of files — Quick Open's workspace tier
 * follows the workspace's `showAllFiles` — so a second copy of this would let
 * one `.zip` open two different ways depending on which door the user used.
 *
 * It never rejects. Every caller here is a fire-and-forget UI gesture, and a
 * refused `openPath` (no registered handler, sandbox denial) is a message to
 * the user, not a failure the caller can do anything about. `basename` is
 * awaited only to name the file in that message, so its own failure degrades
 * to the raw path rather than swallowing the report.
 *
 * @coordinates-with utils/dropPaths.ts — `opensInVMark`, the predicate that picks this door
 * @coordinates-with components/Sidebar/FileExplorer/useExplorerOperations.ts — explorer caller
 * @coordinates-with components/QuickOpen/QuickOpen.tsx — Quick Open caller
 * @module services/navigation/openWithDefaultApp
 */
import { basename } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { fileExplorerError } from "@/utils/debug";

/** Open `path` with the OS default application, reporting a refusal as a toast. */
export async function openWithDefaultApp(path: string): Promise<void> {
  try {
    await openPath(path);
  } catch (error) {
    fileExplorerError(" Failed to open with default app:", error);
    const name = await basename(path).catch(() => path);
    toast.error(i18n.t("dialog:toast.failedToOpenWithDefaultApp", { name }));
  }
}
