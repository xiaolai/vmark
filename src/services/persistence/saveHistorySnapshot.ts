/**
 * Purpose: record a version-history snapshot for a save, and warn the user
 * exactly once per session when the history backend is broken.
 *
 * Key decisions:
 *   - A snapshot failure never fails the save. The file is already on disk;
 *     refusing the save afterwards would be a lie about what happened.
 *   - But it is not silent either. A broken history directory (permissions
 *     changed, disk full) otherwise looks exactly like history working, and
 *     the user finds out when they need a version that was never taken. The
 *     first failure per session warns; the rest stay quiet so a persistently
 *     broken backend does not spam a toast on every keystroke's autosave.
 *   - Awaited by `saveToPath`, deliberately: close flows need best-effort
 *     completion before the window goes.
 *
 * @coordinates-with services/persistence/saveToPath.ts — the caller
 * @coordinates-with services/history/historyOperations.ts — createSnapshot
 * @module services/persistence/saveHistorySnapshot
 */
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { createSnapshot } from "@/services/history/historyOperations";
import { buildHistorySettings } from "@/utils/historyTypes";
import { historyWarn } from "@/utils/debug";

/** Whether a save was user-initiated or automatic. */
export type SaveType = "manual" | "auto";

/** One warning per session — see the header for why this is not per failure. */
let snapshotWarningShown = false;

/**
 * Test-only: reset module-level session flags.
 * @public — accessed dynamically via `("__resetSnapshotFlags" in mod)` in tests,
 * which static analysis (knip) cannot trace; tag prevents a false unused-export report.
 */
export function __resetSnapshotFlags(): void {
  snapshotWarningShown = false;
}

/** Record a snapshot if history is enabled. Never throws. */
export async function recordHistorySnapshot(
  path: string,
  output: string,
  saveType: SaveType
): Promise<void> {
  const { general } = useSettingsStore.getState();
  if (!general.historyEnabled) return;
  try {
    await createSnapshot(path, output, saveType, buildHistorySettings(general));
  } catch (historyError) {
    historyWarn("Failed to create snapshot:", historyError);
    if (!snapshotWarningShown) {
      snapshotWarningShown = true;
      toast.warning(i18n.t("dialog:toast.historySnapshotFailed"), { pin: true });
    }
  }
}
