/**
 * Native chrome theming bridge.
 *
 * Purpose: VMark paints its own UI from CSS tokens, but the window title bar
 * and (on Windows) the menu bar are drawn by the OS and ignore that. This
 * reports the resolved light/dark state to Rust so the native chrome can
 * follow it.
 *
 * Key decisions:
 *   - Platform handling lives in Rust (`window_manager/native_theme.rs`), not
 *     here, so there is one place that decides what each OS does. macOS is a
 *     deliberate no-op there.
 *   - Failures are swallowed. This runs from useTheme's effect *after* the CSS
 *     theme is already applied; a missing command or non-Tauri context must
 *     not break theming of the app's own UI.
 *
 * @coordinates-with window_manager/native_theme.rs — the `set_native_theme` command
 * @coordinates-with hooks/useTheme.ts — sole caller
 * @module services/theme/nativeTheme
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Last value the backend actually accepted. `null` means "nothing delivered
 * yet", so the first report always goes out.
 */
let lastDelivered: boolean | null = null;

/**
 * Report the resolved theme so native window chrome can match it.
 *
 * Cheap to call repeatedly: useTheme's effect re-runs on any theme-affecting
 * settings change (font size, line height…), and only an actual light/dark
 * flip reaches the backend.
 */
export async function syncNativeTheme(isDark: boolean): Promise<void> {
  if (lastDelivered === isDark) return;

  try {
    await invoke("set_native_theme", { dark: isDark });
    // Recorded only on success, so a transient failure is retried on the next
    // theme change rather than being remembered as delivered.
    lastDelivered = isDark;
  } catch {
    // Intentionally silent — see the header.
  }
}

/** Test seam: clear the delivered-state cache between cases. */
export function __resetNativeThemeCache(): void {
  lastDelivered = null;
}
