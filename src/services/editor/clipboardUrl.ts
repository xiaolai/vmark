/**
 * Clipboard URL Helper
 *
 * Provides async clipboard reading with URL detection.
 * Uses Tauri clipboard plugin with web API fallback.
 */

import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useSettingsStore } from "@/stores/settingsStore";
import { detectAndNormalizeUrl } from "./urlDetection";

/**
 * Read clipboard content and check if it's a valid URL.
 * Returns the normalized URL if valid, null otherwise.
 *
 * Uses settings store for custom protocols (e.g., obsidian://, vscode://).
 *
 * @returns Normalized URL string or null
 *
 * @example
 * const url = await readClipboardUrl();
 * if (url) {
 *   // Insert link with clipboard URL
 *   insertLinkWithUrl(view, from, to, url);
 * } else {
 *   // Show URL input field
 *   openLinkEditor();
 * }
 */
export async function readClipboardUrl(): Promise<string | null> {
  try {
    // Try Tauri clipboard first
    let text = await readText();

    // Fallback to web clipboard API if Tauri returns empty
    if (!text && typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        text = await navigator.clipboard.readText();
      } catch {
        // Web clipboard may fail due to permissions
        return null;
      }
    }

    if (!text) {
      return null;
    }

    // Get custom protocols from settings
    const customProtocols = useSettingsStore.getState().advanced.customLinkProtocols ?? [];

    // Detect and normalize URL
    const result = detectAndNormalizeUrl(text.trim(), customProtocols);
    return result.isUrl ? result.normalizedUrl : null;
  } catch {
    // Clipboard access failed
    return null;
  }
}
