/**
 * Window Focus (Hooks Layer)
 *
 * Purpose: Thin wrapper around Tauri window label API.
 *
 * @module services/navigation/windowFocus
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Get the current window's label.
 */
export function getWindowLabel(): string {
  return getCurrentWebviewWindow().label;
}
