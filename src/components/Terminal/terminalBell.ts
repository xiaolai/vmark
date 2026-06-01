/**
 * Terminal bell handling.
 *
 * Purpose: resolve what a terminal BEL should do given the user's bell-mode
 *   preference, and play a short audible beep when requested. The mode is read
 *   live on each bell (in useTerminalSessions), so changing the setting takes
 *   effect on running sessions without re-creating the terminal.
 *
 * @coordinates-with useTerminalSessions.ts — calls these from onBell
 * @module components/Terminal/terminalBell
 */

import type { TerminalBellMode } from "@/stores/settingsStore";

/** What an incoming bell should trigger. */
export type BellAction = "none" | "sound" | "activity";

/**
 * Resolve a bell into an action.
 * - "off"     → nothing.
 * - "audible" → a beep (regardless of which session is active).
 * - "visual"  → a background-activity indicator, but only when the ringing
 *   session is NOT the active one (the active terminal needs no "look here").
 */
export function resolveBellAction(
  mode: TerminalBellMode,
  isActiveSession: boolean
): BellAction {
  if (mode === "off") return "none";
  if (mode === "audible") return "sound";
  // visual
  return isActiveSession ? "none" : "activity";
}

/**
 * Play a short, quiet beep via the Web Audio API. No-op (swallowed) if the
 * browser has no AudioContext or creation fails — the bell must never throw
 * into the terminal data path.
 */
export function playTerminalBell(): void {
  try {
    const g = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctx = g.AudioContext || g.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880; // A5 — a soft, recognizable beep
    gain.gain.value = 0.05; // quiet
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    // Quick fade-out so it isn't a harsh click.
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.stop(now + 0.16);
    osc.onended = () => {
      try {
        void ctx.close();
      } catch {
        /* already closed */
      }
    };
  } catch {
    /* Audio unavailable — bell is best-effort. */
  }
}
