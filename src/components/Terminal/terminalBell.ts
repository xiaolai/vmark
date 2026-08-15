/**
 * Terminal bell handling.
 *
 * Purpose: resolve what a terminal BEL should do given the user's bell-mode
 *   preference, and play a short audible beep when requested. The mode is read
 *   live on each bell (in useTerminalSessions), so changing the setting takes
 *   effect on running sessions without re-creating the terminal.
 *
 * Key decisions:
 *   - ONE process-wide AudioContext, created lazily and never closed. Contexts
 *     are a capped resource; one per bell exhausted the pool during a burst and
 *     killed the audible bell for the rest of the session.
 *
 * @coordinates-with useTerminalSessions.ts — calls these from onBell
 * @module components/Terminal/terminalBell
 */

import type { TerminalBellMode } from "@/stores/settingsStore";
import { terminalLog } from "@/utils/debug";

/**
 * The one AudioContext the bell ever creates (WI-1.4).
 *
 * An AudioContext is a capped process resource — WebKit refuses to hand out
 * more than a handful concurrently. Constructing one per BEL and closing it in
 * `onended` meant a burst (a script printing 20 bells) exhausted the pool, the
 * constructor threw, and the audible bell went permanently dead with the
 * failure swallowed. One context, created lazily on the first bell, reused
 * forever, and never closed — a closed context cannot create nodes, so closing
 * it would silence every later bell.
 */
let sharedAudioContext: AudioContext | null = null;
/** Guard so an unavailable-audio diagnostic is logged once, not once per bell. */
let audioUnavailableLogged = false;

/** Log the "no audible bell" reason exactly once per session. */
function logAudioUnavailableOnce(reason: string): void {
  if (audioUnavailableLogged) return;
  audioUnavailableLogged = true;
  terminalLog(`audible bell unavailable: ${reason}`);
}

/**
 * Return the shared context, creating it on first use. Returns null when the
 * platform has no AudioContext or construction fails — the caller then does
 * nothing. Construction is retried on a later bell, since the failure may be a
 * transient resource cap that clears.
 */
function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioContext) return sharedAudioContext;
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctx = g.AudioContext || g.webkitAudioContext;
  if (!Ctx) {
    logAudioUnavailableOnce("this platform has no AudioContext");
    return null;
  }
  try {
    sharedAudioContext = new Ctx();
  } catch (err) {
    logAudioUnavailableOnce(
      `AudioContext construction failed (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
  return sharedAudioContext;
}

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
 * into the terminal data path. Uses one process-wide context (see above).
 */
export function playTerminalBell(): void {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    // Autoplay policy: a context created before any user gesture starts
    // "suspended", and nodes scheduled on it are silent until it resumes.
    // Best-effort — a rejection just means the beep stays inaudible.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
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
    // No `onended` teardown: the oscillator is garbage once stopped, and the
    // context is deliberately kept alive for the next bell.
  } catch (err) {
    // Audio is best-effort, but a silent bell should still be explainable.
    logAudioUnavailableOnce(
      `bell playback failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Apply a bell for a session: sound, activity mark, OS notice, window flag.
 *
 * Lives here rather than inline in `useTerminalSessions` because it is bell
 * policy, not session lifecycle — and because that hook was over the 300-line
 * limit with it inlined. `bellMode` is read LIVE so a settings change takes
 * effect on already-running sessions (WI-4.3).
 */
export function applyTerminalBell(
  sessionId: string,
  deps: {
    bellMode: string;
    isActive: boolean;
    markActivity: (id: string) => void;
    notify: () => void;
    flagAttention: () => void;
  },
): void {
  const action = resolveBellAction(deps.bellMode as never, deps.isActive);
  if (action.sound) playTerminalBell();
  if (action.markActivity) deps.markActivity(sessionId);
  deps.notify(); // OS notice when an unfocused window rings (#1057)
  deps.flagAttention(); // mark this window in the cross-window status panel (#1057)
}
