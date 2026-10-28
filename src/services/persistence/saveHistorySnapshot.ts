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
 *     completion before the window goes. Bounded, though: a backend that has
 *     not answered by `SNAPSHOT_TIMEOUT_MS` is a failed snapshot, so it can
 *     hold neither the save nor the saves queued behind it on that path.
 *   - An MCP write is filed as its own kind, `mcp`, so history shows which
 *     versions an AI client wrote. Only `auto` snapshots are merged into their
 *     predecessor or skipped above the size limit, so an `mcp` snapshot is
 *     kept exactly as a manual one is. It is linked to the agent edit
 *     journal by the revision id holding its text, when the save was
 *     journaled; a pending or unrecorded save has no link to give.
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

/**
 * Who asked for a save: the user, the autosave timer, or an AI client writing
 * through the MCP bridge.
 */
export type SaveType = "manual" | "auto" | "mcp";

/** How long a save waits for its snapshot before giving it up as failed. */
export const SNAPSHOT_TIMEOUT_MS = 10_000;

/**
 * `work()`, or a rejection once `ms` pass first — by the timer, or by the
 * monotonic clock when `work` lands late but ahead of a timer a stalled event
 * loop held back. The clock starts before `work` is called, so its own
 * synchronous work is charged. The timer never outlives the race.
 */
async function withinDeadline(work: () => Promise<void>, ms: number): Promise<void> {
  const started = performance.now();
  const overdue = () => new Error(`no answer within ${ms} ms`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(overdue()), ms);
  });
  try {
    await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer);
  }
  if (performance.now() - started > ms) throw overdue();
}

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

/**
 * Record a snapshot if history is enabled. Never throws, and settles within
 * `SNAPSHOT_TIMEOUT_MS` (a snapshot still running then may land later). `journalRevision`
 * is the agent edit journal's revision holding the saved text; an `mcp`
 * snapshot stores it as its link, the other kinds store none.
 */
export async function recordHistorySnapshot(
  path: string,
  output: string,
  saveType: SaveType,
  journalRevision: string | null = null
): Promise<void> {
  const { general } = useSettingsStore.getState();
  if (!general.historyEnabled) return;
  // Each save kind is its own snapshot kind. An "auto" snapshot is merged into
  // its predecessor inside the merge window and skipped above the size limit;
  // an "mcp" one is not, so the version a user most wants back after an AI
  // client rewrote the file is always kept.
  try {
    const link = saveType === "mcp" ? journalRevision : null;
    await withinDeadline(() => createSnapshot(path, output, saveType, buildHistorySettings(general), link), SNAPSHOT_TIMEOUT_MS);
  } catch (historyError) {
    historyWarn("Failed to create snapshot:", historyError);
    if (!snapshotWarningShown) {
      snapshotWarningShown = true;
      toast.warning(i18n.t("dialog:toast.historySnapshotFailed"), { pin: true });
    }
  }
}
