/**
 * setupWebLinks
 *
 * Purpose: Wires the xterm.js WebLinksAddon with a click handler that
 * only opens safe URL schemes (http, https, mailto). Caches the dynamic
 * import of the opener plugin across clicks so the first click pays the
 * load cost once.
 *
 * Key decisions:
 *   - Allowlist of schemes prevents accidental file://, javascript:, or
 *     custom-protocol invocations from terminal output.
 *   - Cached `openerPromise` is invalidated on plugin import failure so
 *     the next click can retry.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @module components/Terminal/setupWebLinks
 */
import type { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { terminalLog } from "@/utils/debug";

const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"];

/** Attach the WebLinksAddon to a Terminal with a sandboxed click handler. */
export function setupWebLinks(term: Terminal): void {
  let openerPromise: Promise<{ openUrl: (url: string) => Promise<void> }> | null = null;

  term.loadAddon(new WebLinksAddon((_event, uri) => {
    try {
      const parsed = new URL(uri);
      if (!SAFE_LINK_SCHEMES.includes(parsed.protocol)) {
        terminalLog("Blocked unsafe URL scheme:", parsed.protocol, uri);
        return;
      }
    } catch {
      // Not a valid absolute URL — skip
      return;
    }
    if (!openerPromise) {
      openerPromise = import("@tauri-apps/plugin-opener");
    }
    openerPromise.then(({ openUrl }) => {
      openUrl(uri).catch((error: unknown) => {
        terminalLog(
          "Failed to open URL:",
          error instanceof Error ? error.message : String(error),
        );
      });
    /* v8 ignore start -- @preserve reason: dynamic import of a vi.mock'd module always resolves in tests; the import-failure catch is only reachable in production when the plugin binary is missing */
    }).catch((error: unknown) => {
      openerPromise = null; // Reset on failure so next click retries
      terminalLog(
        "Failed to load opener plugin:",
        error instanceof Error ? error.message : String(error),
      );
    });
    /* v8 ignore stop */
  }));
}
