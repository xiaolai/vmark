/**
 * terminalSessionBell
 *
 * Purpose: builds the per-session onBell handler for createTerminalInstance.
 * Extracted verbatim from useTerminalSessions.ts (WI-TS0.2 pre-split) — the
 * handler reads live store state on every ring (bell mode, active session) so
 * it needs no React closure and no memoization.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @coordinates-with terminalBell.ts — the bell policy it parameterizes
 * @module components/Terminal/terminalSessionBell
 */
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { applyTerminalBell } from "./terminalBell";
import {
  maybeNotifyTerminalBell,
  flagWindowAttentionOnBell,
} from "@/services/terminalAttention";

/** onBell handler for one session. Live store reads per ring — never cached. */
export function sessionBellHandler(sessionId: string): () => void {
  return () =>
    applyTerminalBell(sessionId, {
      bellMode: useSettingsStore.getState().terminal?.bellMode ?? "visual",
      isActive: useUIStore.getState().terminal.activeSessionId === sessionId,
      markActivity: (id) => useUIStore.getState().terminalMarkActivity(id),
      notify: maybeNotifyTerminalBell,
      flagAttention: flagWindowAttentionOnBell,
    });
}
