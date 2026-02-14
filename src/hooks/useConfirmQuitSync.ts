/**
 * Confirm Quit Sync Hook
 *
 * Purpose: Syncs the confirmQuit setting from Zustand to Rust on mount and
 *   on change — Rust uses an AtomicBool to gate Cmd+Q behavior since it
 *   can't read Zustand directly.
 *
 * Key decisions:
 *   - React batches synchronous state updates, so rapid toggles produce one effect
 *   - Rust's AtomicBool::store is idempotent — last write wins, no races
 *
 * @coordinates-with settingsStore.ts — reads general.confirmQuit
 * @module hooks/useConfirmQuitSync
 */

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
export function useConfirmQuitSync() {
  const confirmQuit = useSettingsStore((state) => state.general.confirmQuit);

  useEffect(() => {
    invoke("set_confirm_quit", { enabled: confirmQuit }).catch((err: unknown) => {
      if (import.meta.env.DEV) {
        console.warn("[useConfirmQuitSync] Failed to sync:", err);
      }
    });
  }, [confirmQuit]);
}
