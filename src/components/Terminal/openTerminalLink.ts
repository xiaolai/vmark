/**
 * openTerminalLink
 *
 * Purpose: Opens a web URL clicked in the terminal via the Tauri opener plugin.
 * Catches both import and openUrl rejections to prevent unhandled promise errors.
 *
 * @coordinates-with createTerminalInstance.ts — used as the WebLinksAddon handler
 * @module components/Terminal/openTerminalLink
 */
import { terminalLog } from "@/utils/debug";

/** Open a web link from the terminal. Handles errors from both dynamic import and openUrl. */
export function openTerminalLink(uri: string): void {
  import("@tauri-apps/plugin-opener")
    .then(({ openUrl }) => {
      openUrl(uri).catch((error: unknown) => {
        terminalLog(
          "Failed to open URL:",
          error instanceof Error ? error.message : String(error),
        );
      });
    })
    .catch((error: unknown) => {
      terminalLog(
        "Failed to load opener plugin:",
        error instanceof Error ? error.message : String(error),
      );
    });
}
