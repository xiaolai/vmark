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

/** What an incoming bell should trigger. Both flags can be true: an audible
 *  bell from a *background* session both beeps and flags activity on its tab,
 *  so the user can hear it AND locate which session rang. */
export interface BellAction {
  /** Play the audible beep. */
  sound: boolean;
  /** Flag background activity on the session's tab. */
  markActivity: boolean;
}

/**
 * Resolve a bell into an action.
 * - "off"     → nothing.
 * - "audible" → a beep; for a background session also flag activity so it can
 *   be located (the active session is already on screen — beep only).
 * - "visual"  → flag activity, but only for a background session (the active
 *   terminal needs no "look here" indicator).
 */
export function resolveBellAction(
  mode: TerminalBellMode,
  isActiveSession: boolean
): BellAction {
  return {
    sound: mode === "audible",
    markActivity: mode !== "off" && !isActiveSession,
  };
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
