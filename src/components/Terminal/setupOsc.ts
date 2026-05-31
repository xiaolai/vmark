/**
 * setupOsc
 *
 * Purpose: Registers OSC (Operating System Command) escape-sequence handlers on
 * an xterm.js Terminal. Currently handles OSC 7 (current working directory),
 * which shells emit on every prompt when shell integration is active. The live
 * cwd feeds relative file-link resolution and "new terminal here" (WI-2.x).
 *
 * Key decisions:
 *   - OSC 7 payload is `file://<host>/<path>`. We use the path regardless of
 *     host (matches VS Code / iTerm2 behavior); SSH'd remote cwds still update
 *     the displayed path, which is the least-surprising choice.
 *   - `parseOsc7Cwd` is a pure function so it is unit-tested without a Terminal.
 *   - The handler returns `true` (handled) so xterm doesn't warn about an
 *     unrecognized sequence. Handlers are owned by the term's parser and torn
 *     down when the term is disposed — no explicit cleanup needed.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller; exposes getCwd()
 * @coordinates-with fileLinkProvider.ts — consumes the live cwd for relative paths
 * @module components/Terminal/setupOsc
 */
import type { Terminal } from "@xterm/xterm";

/**
 * Parse an OSC 7 payload (`file://host/path`) into an absolute filesystem path.
 * Returns null if the payload isn't a well-formed `file://` URL.
 */
export function parseOsc7Cwd(data: string): string | null {
  if (!data.startsWith("file://")) return null;
  try {
    const url = new URL(data);
    const path = decodeURIComponent(url.pathname);
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Live state exposed by the OSC handlers. */
export interface OscHandle {
  /** The shell's last-reported cwd (OSC 7), or null if never reported. */
  getCwd: () => string | null;
}

/** Register OSC 7 (cwd) handling on a Terminal and expose the live cwd. */
export function setupOsc7(term: Terminal): OscHandle {
  let cwd: string | null = null;
  term.parser.registerOscHandler(7, (data) => {
    const parsed = parseOsc7Cwd(data);
    if (parsed) cwd = parsed;
    return true; // handled — suppress xterm's unknown-OSC warning
  });
  return { getCwd: () => cwd };
}
