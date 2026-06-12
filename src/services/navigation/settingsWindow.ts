/**
 * Settings Window Utility
 *
 * Purpose: Shared logic for opening or refocusing the Settings window.
 *
 * Key decisions:
 *   - Delegates native window creation to Rust so utility-window chrome,
 *     menu inheritance, and close behavior stay consistent across platforms
 *   - Section navigation is handled by the backend singleton window manager
 *
 * @coordinates-with window_manager.rs — open_settings_window command
 * @coordinates-with SettingsPage.tsx — renders the settings UI in the new window
 * @module services/navigation/settingsWindow
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Open the Settings window, optionally navigating to a specific section.
 *
 * - If Settings window exists, Rust focuses it and navigates to the section
 * - If not, Rust creates it with platform-specific native chrome
 *
 * @param section - Optional section to navigate to (e.g., "integrations", "about")
 */
export async function openSettingsWindow(section?: string): Promise<void> {
  await invoke("open_settings_window", {
    section: section || null,
  });
}
