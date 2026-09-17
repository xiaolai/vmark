/**
 * Close-to-Tray Sync Hook (#1419)
 *
 * Purpose: pushes the Windows close-to-tray preference from Zustand to Rust on
 *   mount and on change. Rust decides what a close does, and it cannot read
 *   Zustand, so it holds its own copy in an AtomicBool.
 *
 * Key decisions:
 *   - Same shape as useConfirmQuitSync: a boolean, idempotent on the Rust side,
 *     so a repeat push is harmless and the last write wins.
 *   - Windows only. The feature is never effective elsewhere; pushing there
 *     would record a value nothing reads. Skipping it makes that explicit.
 *   - A failed push is logged, never thrown. Rust starts disabled, so a push
 *     that did not land leaves the old close behaviour in force.
 *
 * @coordinates-with settingsStore.ts — reads general.closeToTray
 * @coordinates-with src-tauri/src/close_to_tray/mod.rs — set_close_to_tray
 * @module hooks/useCloseToTraySync
 */

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { isWindowsPlatform } from "@/utils/platform";
import { closeToTrayWarn } from "@/utils/debug";

/** Sync general.closeToTray to Rust on mount and on change (Windows only). */
export function useCloseToTraySync() {
  const closeToTray = useSettingsStore((state) => state.general.closeToTray);

  useEffect(() => {
    if (!isWindowsPlatform()) return;
    invoke("set_close_to_tray", { enabled: closeToTray }).catch((err: unknown) => {
      closeToTrayWarn("Failed to sync:", err);
    });
  }, [closeToTray]);
}
