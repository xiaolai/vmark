/**
 * Window geometry capture for hot-exit sessions.
 *
 * Reads the current OS window position and outer dimensions from synchronous
 * webview globals so a future restore can reposition/resize the window. Kept
 * in its own module so the capture hook stays focused on tab/UI state.
 *
 * @module services/persistence/resilience/windowGeometry
 */
import type { WindowState } from "../hotExit/types";

/**
 * Capture the current window geometry from synchronous webview globals.
 *
 * Returns null when any value is non-finite or the dimensions are
 * non-positive — a degenerate geometry is worse than none, and the field is
 * `WindowGeometry | null` by contract.
 */
export function captureWindowGeometry(): WindowState["geometry"] {
  const x = window.screenX;
  const y = window.screenY;
  const width = window.outerWidth;
  const height = window.outerHeight;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
}
