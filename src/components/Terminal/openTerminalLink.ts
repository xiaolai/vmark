/**
 * openTerminalLink
 *
 * Purpose: Opens a URL from a terminal web link click via the Tauri opener plugin.
 * Catches both dynamic-import and openUrl rejections to prevent unhandled
 * promise rejections when links fail (e.g., sandbox denial, invalid URI).
 *
 * @coordinates-with createTerminalInstance.ts — used as WebLinksAddon callback
 * @module components/Terminal/openTerminalLink
 */
import { terminalLog } from "@/utils/debug";

/** Open a URI from a terminal link click, logging any errors. */
export async function openTerminalLink(uri: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(uri);
  } catch (error: unknown) {
    terminalLog(
      "Failed to open URL:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
