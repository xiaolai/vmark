/**
 * resolveHelperTextarea
 *
 * Purpose: resolve the terminal's helper textarea via the PUBLIC `term.textarea`
 * getter (WI-1.1) and assert the DOM-topology invariant the gate path relies on
 * (WI-1.2), failing LOUD instead of the old silent no-op that disabled the whole
 * IME layer when an internal `.xterm-helper-textarea` lookup returned null.
 *
 * Fail-loud policy: throw in dev (surface the misconfiguration immediately); in
 * prod persist an error via `terminalError` (reaches the user's attachable log)
 * and return best-effort so the terminal still works minus IME.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @module components/Terminal/resolveHelperTextarea
 */
import type { Terminal } from "@xterm/xterm";
import { terminalError } from "@/utils/debug";

/** Resolve + validate the helper textarea. Returns undefined only in prod when
 *  it is missing (dev throws). `isDev` is injected for testability. */
export function resolveHelperTextarea(
  term: Terminal,
  container: HTMLElement,
  isDev: boolean = import.meta.env.DEV,
): HTMLTextAreaElement | undefined {
  const textarea = term.textarea;
  if (!textarea) {
    const msg = "term.textarea is absent after open() — IME layer cannot attach";
    if (isDev) throw new Error(msg);
    terminalError(msg);
    return undefined;
  }
  if (!container.contains(textarea)) {
    const msg = "term.textarea is not inside the terminal container";
    if (isDev) throw new Error(msg);
    terminalError(msg);
  }
  return textarea;
}
