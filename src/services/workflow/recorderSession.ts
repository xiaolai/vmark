/**
 * Host-owned recording session (WI-NB7.1 / D2v2).
 *
 * The recorder's capture SHIM lives in the page world (`recorderShim.src.js`), but a
 * page-world DOM buffer dies on every cross-document navigation — so a multi-page
 * recording cannot be assembled by reading the buffer once at stop. This service is
 * the HOST-OWNED half that makes cross-document recording work:
 *
 *   - it drains the shim buffer on a timer (default 500 ms) and at stop, so most
 *     events are captured before a navigation discards the buffer;
 *   - it records each NAVIGATION host-side — the entry URL at start, then every
 *     native `browser://navigated` event, never a page claim — and RE-ARMS the shim
 *     in the fresh document;
 *   - it caps the session at 1000 events, whatever the per-document shim cap; and
 *   - it owns the lifecycle: one recording per tab, duplicate start refused, stop
 *     without start refused, tab close/disable discards.
 *
 * The session lives HERE, in the webview service — never in the page, which is
 * untrusted. Finalization runs the accumulated trace through the trusted host-side
 * redactor (`recordingToWorkflow`), so the returned workflow is value-free.
 *
 * Residual (D2v2): events between the last drain and a navigation commit can be lost,
 * bounded by the drain interval; the navigation record itself is never lost.
 *
 * @coordinates-with lib/browser/agent/recorderShim.ts — the isolated-world arm/drain scripts
 * @coordinates-with lib/browser/workflow/recorder.ts — the trusted redactor at finalize
 * @coordinates-with services/mcpBridge/v2/browserRecord.ts — the MCP start/stop handler
 * @module services/workflow/recorderSession
 */

import { recordingToWorkflow, type RecordedEvent } from "@/lib/browser/workflow/recorder";

/** Whole-session cap, independent of the per-document shim ring buffer. */
const MAX_SESSION_EVENTS = 1000;
/** Default drain cadence — most of a document's events land before it navigates away. */
const DRAIN_INTERVAL_MS = 500;

/** The host operations a session needs, injected so the service is testable without
 *  the Tauri `browser_eval` bridge. */
export interface RecorderDeps {
  /** Re-write the arm marker in the current document (read-class; the consent gate
   *  was the initial arm). Best-effort — a failure just risks tail loss. */
  rearm(tabId: string, generation: number): Promise<void>;
  /** Remove the arm marker so the shim stops capturing immediately (read-class —
   *  it only touches VMark's own injected element, like the console buffer clear). */
  disarm(tabId: string, generation: number): Promise<void>;
  /** Read AND clear the shim ring buffer, returning the captured events (read-class). */
  drainOnce(tabId: string, generation: number): Promise<RecordedEvent[]>;
  /** Schedule the periodic drain; returns a canceller. Default: `setInterval`. */
  schedule?: (tick: () => void) => () => void;
}

interface RecorderSession {
  tabId: string;
  site: string;
  generation: number;
  events: RecordedEvent[];
  capped: boolean;
  deps: RecorderDeps;
  cancel: () => void;
  /** Every drain and navigation is queued here, so a periodic, a manual and a final
   *  drain can never overlap (read-and-clear calls that interleave reorder or lose
   *  events), and a navigation cannot be appended ahead of the drain that precedes it. */
  chain: Promise<void>;
  /** The single stop in flight, so two concurrent stops finalize once. */
  stopping: Promise<{ source: string; inputs: string[]; eventCount: number; capped: boolean }> | null;
  /** True only while the stop performs its own final drain. */
  finalDrain: boolean;
}

/** Run `work` after everything already queued on the session, and keep the chain alive
 *  whatever `work` does. */
function enqueue(session: RecorderSession, work: () => Promise<void>): Promise<void> {
  const next = session.chain.then(work, work);
  session.chain = next.catch(() => undefined);
  return session.chain;
}

/** tabId → the one active recording. */
const sessions = new Map<string, RecorderSession>();

export interface StartRecorderArgs {
  tabId: string;
  site: string;
  generation: number;
  /** The tab's committed URL at start. Recorded host-side as the workflow's ENTRY
   *  `navigate to` step (the redactor strips it to origin+path), so a replay
   *  begins on the page the recording did. */
  startUrl: string;
  deps: RecorderDeps;
}

/** Whether the tab has an active recording. */
export function isRecording(tabId: string): boolean {
  return sessions.has(tabId);
}

/** Begin a recording. The caller must already have obtained `record` consent and
 *  armed the shim. Refuses a second recording on the same tab. */
export function startRecorderSession(args: StartRecorderArgs): { ok: true } | { ok: false; error: string } {
  if (sessions.has(args.tabId)) return { ok: false, error: "recording-already-active" };
  const schedule =
    args.deps.schedule ??
    ((tick: () => void) => {
      const t = setInterval(tick, DRAIN_INTERVAL_MS);
      return () => clearInterval(t);
    });
  const session: RecorderSession = {
    tabId: args.tabId,
    site: args.site,
    generation: args.generation,
    // The entry point is a host-side record (D2v2) — the page never supplies a URL.
    events: [{ type: "navigate", url: args.startUrl }],
    capped: false,
    deps: args.deps,
    cancel: () => {},
    chain: Promise.resolve(),
    stopping: null,
    finalDrain: false,
  };
  sessions.set(args.tabId, session);
  session.cancel = schedule(() => {
    void drainActiveRecording(args.tabId);
  });
  return { ok: true };
}

/** Append events up to the session cap; sets `capped` and stops once the cap is hit. */
function appendCapped(session: RecorderSession, events: readonly RecordedEvent[]): void {
  for (const ev of events) {
    if (session.events.length >= MAX_SESSION_EVENTS) {
      session.capped = true;
      return;
    }
    session.events.push(ev);
  }
}

/** Drain the shim buffer once and append. A drain error is swallowed — a single
 *  failed poll must not tear down an in-progress recording. */
export async function drainActiveRecording(tabId: string): Promise<void> {
  const session = sessions.get(tabId);
  if (!session) return;
  if (session.stopping && !session.finalDrain) return; // only the stop's own drain runs now
  await enqueue(session, async () => {
    let events: RecordedEvent[];
    try {
      events = await session.deps.drainOnce(tabId, session.generation);
    } catch {
      return;
    }
    appendCapped(session, events);
  });
}

/** Record a navigation host-side (from the native event) and re-arm the new document.
 *  The URL is stripped to origin+path by the redactor at finalize; the new generation
 *  becomes the one drains and re-arms use. */
export async function recordNavigation(tabId: string, url: string, newGeneration: number): Promise<void> {
  const session = sessions.get(tabId);
  if (!session || session.stopping) return; // a stopping session takes no new work
  // Queued behind any drain in flight: the old document's remaining events belong
  // BEFORE the navigation, and the drain must still run against the old generation.
  await enqueue(session, async () => {
    session.generation = newGeneration;
    appendCapped(session, [{ type: "navigate", url }]);
    try {
      await session.deps.rearm(tabId, newGeneration);
    } catch {
      // Best-effort: a failed re-arm risks tail loss on the new document, never a crash.
    }
  });
}

/** Finalize the recording: a last drain, stop the timer, and convert the trace into
 *  value-free workflow source. Returns null if the tab was not recording. */
export async function stopRecorderSession(
  tabId: string,
): Promise<{ source: string; inputs: string[]; eventCount: number; capped: boolean } | null> {
  const session = sessions.get(tabId);
  if (!session) return null;
  if (session.stopping) return session.stopping; // a second stop joins the first
  // Cancel the schedule synchronously, so no periodic drain is queued after the final one.
  session.cancel();
  session.finalDrain = true;
  session.stopping = (async () => {
    await drainActiveRecording(tabId);
    session.finalDrain = false;
    // Stop capture immediately — best-effort; a failure only leaves an inert marker.
    try {
      await session.deps.disarm(tabId, session.generation);
    } catch {
      /* the session is ending anyway */
    }
    sessions.delete(tabId);
    const { source, inputs } = recordingToWorkflow(session.events, { site: session.site });
    return { source, inputs, eventCount: session.events.length, capped: session.capped };
  })();
  return session.stopping;
}

/** Discard a recording without finalizing (tab close/disable). */
export function abortRecorderSession(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.cancel();
  sessions.delete(tabId);
}

/** Test-only: clear all recording state (and any real timers). */
export function __resetRecorderSessions(): void {
  for (const session of sessions.values()) session.cancel();
  sessions.clear();
}
