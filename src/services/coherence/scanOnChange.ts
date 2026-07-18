/**
 * Coherence scan-on-change (WI-1.12 watcher wiring)
 *
 * Purpose: keep the coherence ledger's observed-external history current
 * by running a debounced kernel scan after workspace file events. Display
 * stays strictly pull-based (R14 — the breakdown never auto-opens);
 * only *reconciliation* rides the watcher, so external edits are already
 * honest history by the time anything pulls.
 *
 * Key decisions:
 *   - Trailing 3 s debounce; one scan in flight at a time (a burst of
 *     events collapses into one pass).
 *   - Fire-and-forget: scan failures log and never surface to the user
 *     (the next pull retries).
 *
 * @coordinates-with src-tauri/src/coherence/scan.rs — the reconciliation pass
 * @coordinates-with useWindowFileWatcher.ts — emits the fs:changed events
 * @module services/coherence/scanOnChange
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { coherenceLog } from "@/utils/debug";

const DEBOUNCE_MS = 3000;

/**
 * Start listening for workspace file changes; returns a disposer.
 * Injectable listen/invoke for tests.
 */
export function startCoherenceScanOnChange(
  deps: { listen: typeof listen; invoke: typeof invoke } = { listen, invoke }
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scanning = false;
  let rerunAfter = false;
  let disposed = false;
  let unlisten: (() => void) | null = null;

  const runScan = async () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root || disposed) return;
    if (scanning) {
      // An event landed mid-scan: run once more afterwards so nothing is
      // permanently lost (audit T10).
      rerunAfter = true;
      return;
    }
    scanning = true;
    try {
      await deps.invoke("coherence_scan", { workspaceRoot: root });
    } catch (error) {
      coherenceLog("scan-on-change failed (next pull retries):", error);
    } finally {
      scanning = false;
      if (rerunAfter && !disposed) {
        rerunAfter = false;
        void runScan();
      }
    }
  };

  const schedule = (event: unknown) => {
    if (disposed) return;
    // Only this window's workspace triggers a scan (audit T11): the raw
    // fs:changed event is app-global and carries its root.
    const root = useWorkspaceStore.getState().rootPath;
    const eventRoot = (event as { payload?: { rootPath?: string } })?.payload?.rootPath;
    if (!root || (typeof eventRoot === "string" && eventRoot !== root)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runScan();
    }, DEBOUNCE_MS);
  };

  void deps
    .listen("fs:changed", schedule)
    .then((un) => {
      if (disposed) un();
      else unlisten = un;
    })
    .catch((error) => coherenceLog("scan-on-change listen failed:", error));

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unlisten?.();
  };
}
