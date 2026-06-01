/**
 * setupWebLinks
 *
 * Purpose: Wires URL opening for the terminal — both the WebLinksAddon
 * (regex-detected URLs) and OSC 8 hyperlinks (explicit `\e]8;;URL\e\\` links
 * emitted by `ls --hyperlink`, gcc, gh, etc., WI-4.2). Both routes share one
 * allowlisted, lazily-loaded opener so only safe schemes are launched.
 *
 * Key decisions:
 *   - Allowlist of schemes prevents accidental file://, javascript:, or
 *     custom-protocol invocations from terminal output.
 *   - OSC 8 links are rendered natively by xterm; activation is routed through
 *     `term.options.linkHandler` to the same `openSafeUri` as regex links.
 *   - Cached `openerPromise` is invalidated on plugin import failure so
 *     the next click can retry.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @module components/Terminal/setupWebLinks
 */
import type { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { terminalLog } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"];

/** Attach the WebLinksAddon AND OSC 8 hyperlink handling, both sandboxed. */
export function setupWebLinks(term: Terminal): void {
  let openerPromise: Promise<{ openUrl: (url: string) => Promise<void> }> | null = null;

  /** Open a URI iff its scheme is allowlisted, via the cached opener plugin. */
  const openSafeUri = (uri: string): void => {
    // Reject control chars (terminal output can smuggle them) before parsing.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(uri)) {
      terminalLog("Blocked URL with control characters");
      return;
    }
    // Also reject percent-encoded controls (e.g. %0d%0a → CRLF injection into a
    // mailto: handler) that the raw check above can't see (Codex audit).
    if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(uri)) {
      terminalLog("Blocked URL with encoded control characters");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      // Not a valid absolute URL — skip
      return;
    }
    if (!SAFE_LINK_SCHEMES.includes(parsed.protocol)) {
      terminalLog("Blocked unsafe URL scheme:", parsed.protocol, uri);
      return;
    }
    if (!openerPromise) {
      openerPromise = import("@tauri-apps/plugin-opener");
    }
    // Open the parsed/normalized href, not the raw string, so the launcher
    // sees exactly what the scheme check validated.
    const href = parsed.href;
    openerPromise.then(({ openUrl }) => {
      openUrl(href).catch((error: unknown) => {
        terminalLog("Failed to open URL:", errorMessage(error));
      });
    /* v8 ignore start -- @preserve reason: dynamic import of a vi.mock'd module always resolves in tests; the import-failure catch is only reachable in production when the plugin binary is missing */
    }).catch((error: unknown) => {
      openerPromise = null; // Reset on failure so next click retries
      terminalLog("Failed to load opener plugin:", errorMessage(error));
    });
    /* v8 ignore stop */
  };

  // Regex-detected URLs.
  term.loadAddon(new WebLinksAddon((_event, uri) => openSafeUri(uri)));

  // OSC 8 explicit hyperlinks (WI-4.2) — xterm renders them; route activation
  // through the same allowlisted opener.
  term.options.linkHandler = {
    activate: (_event, uri) => openSafeUri(uri),
  };
}
