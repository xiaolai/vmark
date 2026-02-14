/**
 * Window Focus (Hooks Layer)
 *
 * Purpose: Thin wrappers around Tauri window focus APIs — used to ensure
 *   menu events only trigger in the currently focused window.
 *
 * @module hooks/useWindowFocus
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Check if the current window is focused.
 * Used to ensure menu events only trigger in the focused window.
 */
export async function isWindowFocused(): Promise<boolean> {
  try {
    return await getCurrentWebviewWindow().isFocused();
  } catch {
    return false;
  }
}

/**
 * Get the current window's label.
 */
export function getWindowLabel(): string {
  return getCurrentWebviewWindow().label;
}
