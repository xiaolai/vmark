/**
 * Window commands — the app-level window arrangement actions (WI-FL3.10).
 *
 * Purpose: `window.bringAllToFront` is the handler behind the macOS Window →
 * Bring All to Front menu item, which emitted `menu:bring-all-to-front` to no
 * listener at all. It reproduces AppKit's `arrangeInFront:` semantics from the
 * webview: every visible, non-minimized window of the app is ordered to the
 * front, and the window the user was in is focused LAST so it stays on top.
 * Minimized windows stay in the Dock, and a hidden helper window (the PDF
 * renderer) is never shown — `set_focus` would order it onscreen.
 *
 * Done from the webview rather than as a Tauri command because the window
 * API already exposes everything needed under the document capability, so
 * there is no IPC contract to add.
 *
 * @coordinates-with hooks/useCommandBootstrap.ts — routes menu:bring-all-to-front here
 * @module services/commands/windowCommands
 */

import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import i18n from "@/i18n";
import { registerCommands } from "./CommandBus";
import { menuError } from "@/utils/debug";

/** Bring every visible window forward, ending on the current one. */
async function bringAllWindowsToFront(): Promise<void> {
  const current = getCurrentWebviewWindow();
  // Best-effort like every other step (audit #949). Enumeration was the one
  // await outside a guard, so its rejection rejected the whole command —
  // including the current-window focus below, which needs no enumeration at
  // all. "Never a rejection" is this handler's stated contract.
  let windows: Awaited<ReturnType<typeof getAllWebviewWindows>> = [];
  try {
    windows = await getAllWebviewWindows();
  } catch (error) {
    menuError("bring-all-to-front: could not enumerate windows:", error);
  }
  for (const window of windows) {
    if (window.label === current.label) continue;
    try {
      if (!(await window.isVisible()) || (await window.isMinimized())) continue;
      await window.setFocus();
    } catch (error) {
      // One window that is mid-close must not stop the rest from coming forward.
      menuError(`bring-all-to-front: window "${window.label}" skipped:`, error);
    }
  }
  try {
    // The SAME eligibility the loop applies (audit #950). "Minimized windows
    // stay in the Dock" and "a hidden window is never shown" are this
    // command's stated invariants, and an unconditional focus exempted the one
    // window most able to break them: the loop above awaits, so a minimize
    // that lands during it would be undone here, and `set_focus` on a hidden
    // helper (the PDF renderer) orders it onscreen.
    if (!(await current.isVisible()) || (await current.isMinimized())) return;
    await current.setFocus();
  } catch (error) {
    // The current window can be mid-close too (audit #460): the others have
    // already come forward, and that is the whole command — never a rejection.
    menuError("bring-all-to-front: current window could not be focused:", error);
  }
}

/** Owner token the window commands register under (HMR-safe, replace-own). */
const WINDOW_COMMANDS_OWNER = "window-commands";

export function registerWindowCommands(): void {
  // Owner-based, not a `hasCommand` sentinel (audit #461): a reload replaces
  // this owner's batch, while an identically named command from ANOTHER
  // registrar is refused up front instead of being silently kept.
  registerCommands(WINDOW_COMMANDS_OWNER, [
    {
      id: "window.bringAllToFront",
      title: () => i18n.t("commands:window.bringAllToFront"),
      category: "app",
      run: bringAllWindowsToFront,
    },
  ]);
}
