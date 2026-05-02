/**
 * setupFileLinks
 *
 * Purpose: Registers a file-link provider on an xterm.js Terminal. When the
 * user clicks a detected file path in terminal output, the file is opened
 * as a new editor tab — guarded by a 10MB size cap to avoid stalling the UI.
 *
 * Key decisions:
 *   - File size is checked via `stat()` before reading; oversized files are
 *     rejected and the limit is reported back into the terminal as a yellow
 *     ANSI message so the user knows why nothing happened.
 *   - `stat()` failures (permission denied, missing) surface to the user
 *     via the same ANSI channel — fail loud, never silent.
 *   - Dynamic import keeps the fs plugin out of the initial bundle.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @coordinates-with fileLinkProvider.ts — link-detection logic
 * @module components/Terminal/setupFileLinks
 */
import type { Terminal } from "@xterm/xterm";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { createFileLinkProvider } from "./fileLinkProvider";
import { terminalLog } from "@/utils/debug";

const MAX_FILE_LINK_SIZE = 10 * 1024 * 1024; // 10 MB

/** Attach the file-link provider to a Terminal. */
export function setupFileLinks(term: Terminal): void {
  term.registerLinkProvider(createFileLinkProvider(term, (filePath) => {
    import("@tauri-apps/plugin-fs").then(async ({ readTextFile, stat }) => {
      try {
        const info = await stat(filePath);
        if (info.size > MAX_FILE_LINK_SIZE) {
          const sizeMb = Math.round(info.size / 1024 / 1024);
          terminalLog("File too large to open in editor:", filePath, `(${sizeMb}MB)`);
          term.writeln(`\x1b[33m[File too large: ${sizeMb}MB, max 10MB]\x1b[0m`);
          return;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        terminalLog("stat failed for file link:", filePath, message);
        term.writeln(`\x1b[33m[Cannot open file: ${message}]\x1b[0m`);
        return;
      }
      readTextFile(filePath).then((content) => {
        const windowLabel = getCurrentWindowLabel();
        const tabId = useTabStore.getState().createTab(windowLabel, filePath);
        useDocumentStore.getState().initDocument(tabId, content, filePath);
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        terminalLog("File not readable:", message);
        term.writeln(`\x1b[33m[Cannot open file: ${message}]\x1b[0m`);
      });
    /* v8 ignore start -- @preserve reason: dynamic import of a vi.mock'd module always resolves in tests; the import-failure catch is only reachable in production when the plugin binary is missing */
    }).catch((error: unknown) => {
      terminalLog(
        "Failed to load fs plugin:",
        error instanceof Error ? error.message : String(error),
      );
    });
    /* v8 ignore stop */
  }));
}
