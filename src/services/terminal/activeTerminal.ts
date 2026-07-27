/**
 * activeTerminal
 *
 * Purpose: The window-scoped handle on terminal instances, so non-React
 * callers can reach a live xterm without threading a ref through the component
 * tree (WI-4.3 "Run in Terminal").
 *
 * Why it lives in `services/` and not next to the terminal components: the
 * consumer is `services/terminal/runInTerminal.ts`, and `services/` may not
 * import from `components/` (ADR-013's tier rule, enforced by
 * `pnpm lint:deps`). The terminal component registers itself here instead —
 * components importing services is the allowed direction.
 *
 * The resolver takes a session id rather than always answering "whichever is
 * active now": a deferred delivery must land in the session the request was
 * made for, even if the user switched tabs while it was in flight.
 *
 * Module state is per-webview, which is exactly the scope wanted: a second
 * VMark window must not paste into the first window's shell.
 *
 * @coordinates-with components/Terminal/useTerminalSessions.ts — registers the resolver
 * @coordinates-with services/terminal/runInTerminal.ts — consumes it
 * @module services/terminal/activeTerminal
 */
import type { Terminal } from "@xterm/xterm";

/**
 * The slice of xterm a non-React caller needs to deliver a payload. `modes` is
 * part of the contract because delivery SAFETY depends on bracketed-paste
 * mode — see the security note in runInTerminal.
 */
export type RunTargetTerminal = Pick<Terminal, "paste" | "focus" | "modes">;

/** Resolves a session id to its live terminal, or null when it is gone. */
export type TerminalResolver = (sessionId: string) => RunTargetTerminal | null;

let resolver: TerminalResolver | null = null;

/**
 * Publish the terminal resolver for this window. Returns an unregister
 * function; call it on unmount so a torn-down panel cannot hand out a disposed
 * terminal.
 */
export function registerTerminalResolver(next: TerminalResolver): () => void {
  resolver = next;
  return () => {
    // Only clear if we are still the registered one — a remount registers the
    // new resolver before the old effect's cleanup runs, and clearing
    // unconditionally would unregister the panel that is actually live.
    if (resolver === next) resolver = null;
  };
}

/** The live terminal for `sessionId`, or null when it is not mounted/ready. */
export function getTerminalForSession(sessionId: string): RunTargetTerminal | null {
  return resolver?.(sessionId) ?? null;
}
