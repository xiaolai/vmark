/**
 * useHotExitRestore — React lifecycle wiring for hot-exit window restore.
 *
 * Pure lifecycle only: it creates a `WindowRestoreCoordinator` (the concurrency
 * guard + per-window restore flow live React-free in
 * `services/persistence/resilience/_hotExitRestore.ts`, ADR-013) and wires it to
 * mount/unmount plus the RESTORE_START fallback listener.
 *
 * @coordinates-with services/persistence/resilience/_hotExitRestore.ts — the coordinator
 * @module hooks/resilience/_hotExitRestore
 */

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { hotExitLog } from "@/utils/debug";
import { HOT_EXIT_EVENTS } from "@/services/persistence/hotExit/types";
import {
  createWindowRestoreCoordinator,
  type WindowRestoreCoordinator,
} from "@/services/persistence/resilience/_hotExitRestore";

export function useHotExitRestore() {
  // The coordinator is created once per mount and holds the restore state
  // machine; the hook only wires it to mount/unmount lifecycle.
  const coordinatorRef = useRef<WindowRestoreCoordinator | null>(null);

  useEffect(() => {
    const windowLabel = getCurrentWebviewWindow().label;
    const coordinator =
      coordinatorRef.current ?? createWindowRestoreCoordinator(windowLabel);
    coordinatorRef.current = coordinator;

    void coordinator.checkPending();

    // Listen for RESTORE_START signal (fallback for main window). Primary
    // restore is triggered directly by checkAndRestoreSession(); this listener
    // is guarded against double-restore.
    const unlistenPromise = listen(HOT_EXIT_EVENTS.RESTORE_START, () =>
      coordinator.onRestoreStart(),
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch((e) => {
        hotExitLog("Cleanup error (expected during unmount):", e);
      });
    };
  }, []);
}
