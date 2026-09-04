/**
 * rescanScheduler — when the file tree re-lists itself, decided without React.
 *
 * Purpose: turn "an fs event batch arrived" into "run one full scan, soon, once"
 * — and keep a workspace that never stops changing from turning the scan into a
 * CPU-bound loop (#1357).
 *
 * The loop it replaces: every event batch called the scan; a batch arriving while
 * a scan ran set a rerun flag; the scan's `finally` ran the scan again at once. If
 * at least one event landed during each scan, the scan restarted back to back
 * forever — the slower the scan, the more certain the next event was to land
 * inside it. Measured by the reporter: 19–23 full rescans a minute for 36 minutes,
 * one core pinned, the period set by the scan's own duration.
 *
 * Three rules, each pinned by `rescanScheduler.test.ts`:
 *   1. Trailing debounce. A request runs `quietMs` after the LAST request, so a
 *      burst (git checkout, a download's chunks, an unarchive) is one scan.
 *   2. No starvation. A stream of requests that never goes quiet still runs a
 *      scan within `maxWaitMs` of the first unserved request — the tree must not
 *      freeze while something keeps writing.
 *   3. Back-off under churn. When a scan ends and requests arrived DURING it, the
 *      next scan waits at least `gapMs`, and `gapMs` doubles each consecutive time
 *      that happens (up to `maxGapMs`). A quiet scan resets it. Continuous churn
 *      therefore costs a scan every `maxGapMs`, not every scan-duration.
 *
 * One scan runs at a time. `refreshNow` (window focus, the manual refresh button)
 * skips the debounce but not the single-flight rule: during a scan it coalesces
 * into the follow-up, which then obeys the gap.
 *
 * @coordinates-with components/Sidebar/FileExplorer/useFileTree.ts — the consumer
 * @module components/Sidebar/FileExplorer/rescanScheduler
 */

export interface RescanTiming {
  /** Run this long after the last request (trailing debounce). */
  quietMs: number;
  /** Never let a request wait longer than this, however busy the stream. */
  maxWaitMs: number;
  /** Minimum rest after a scan that saw requests during it; doubles per repeat. */
  gapMs: number;
  /** Ceiling for the doubled gap. */
  maxGapMs: number;
}

/** Defaults: measured against a tree scan that takes seconds on a large root. */
export const DEFAULT_RESCAN_TIMING: RescanTiming = {
  quietMs: 400,
  maxWaitMs: 2_000,
  gapMs: 1_000,
  maxGapMs: 30_000,
};

export interface RescanScheduler {
  /** An fs event batch: coalesce into the next scan. */
  request: () => void;
  /** Focus or manual refresh: scan now unless one is running (then coalesce).
   *  Resolves once the scan that serves this call has finished (or on dispose). */
  refreshNow: () => Promise<void>;
  /** Cancel anything pending; a scan already running finishes but schedules nothing. */
  dispose: () => void;
  /** Consecutive scans that saw requests during them (0 after a quiet scan). */
  churn: () => number;
}

/**
 * Build a scheduler around `scan`. `scan` must resolve when the scan is over
 * (it may reject; a rejection counts as "over" and never stops scheduling).
 * Time comes from the platform clock and timers (tests use fake timers).
 */
export function createRescanScheduler(
  scan: () => Promise<unknown>,
  timing: RescanTiming = DEFAULT_RESCAN_TIMING,
): RescanScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;
  /** Requests arrived since the current scan started (or since the last one ended). */
  let dirty = false;
  /** When the oldest unserved request arrived; bounds the debounce (rule 2). */
  let firstDirtyAt: number | null = null;
  /** Consecutive scans that ended dirty. */
  let churnCount = 0;
  /** A rest the next scan must not start before (rule 3). */
  let notBefore = 0;
  /** `refreshNow` callers waiting for the NEXT scan to start, then for it to end. */
  let waitingForNext: Array<() => void> = [];
  let waitingForCurrent: Array<() => void> = [];

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const armAt = (when: number) => {
    clear();
    timer = setTimeout(fire, Math.max(0, when - Date.now()));
  };

  /** Rules 1 and 2: the moment the pending request should run, given now. */
  const dueAt = () => {
    const now = Date.now();
    const byQuiet = now + timing.quietMs;
    const byMaxWait = (firstDirtyAt ?? now) + timing.maxWaitMs;
    return Math.max(Math.min(byQuiet, byMaxWait), notBefore);
  };

  const start = () => {
    if (disposed || inFlight) return;
    clear();
    inFlight = true;
    dirty = false;
    firstDirtyAt = null;
    waitingForCurrent = waitingForNext;
    waitingForNext = [];
    // The scan STARTS synchronously: a caller that clears the tree right after
    // asking for a refresh must find the scan already begun (and stamped with a
    // request id it can invalidate), never one that begins after the clear.
    let running: Promise<unknown>;
    try {
      running = Promise.resolve(scan());
    } catch (error) {
      running = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    void running
      .catch(() => undefined)
      .then(() => {
        inFlight = false;
        const served = waitingForCurrent;
        waitingForCurrent = [];
        for (const resolve of served) resolve();
        if (disposed) return;
        if (!dirty) {
          churnCount = 0;
          notBefore = 0;
          return;
        }
        // Rule 3: the scan saw requests during it — rest, longer each time.
        churnCount += 1;
        const gap = Math.min(timing.gapMs * 2 ** (churnCount - 1), timing.maxGapMs);
        notBefore = Date.now() + gap;
        armAt(dueAt());
      });
  };

  const fire = () => {
    timer = null;
    if (disposed) return;
    if (inFlight) return; // the scan's end reschedules
    if (Date.now() < notBefore) {
      armAt(notBefore);
      return;
    }
    start();
  };

  return {
    request: () => {
      if (disposed) return;
      if (!dirty) firstDirtyAt = Date.now();
      dirty = true;
      if (inFlight) return; // coalesced into the follow-up
      armAt(dueAt());
    },
    refreshNow: () => {
      if (disposed) return Promise.resolve();
      const done = new Promise<void>((resolve) => waitingForNext.push(resolve));
      if (inFlight) {
        // Coalesced into the follow-up: served when THAT scan ends.
        if (!dirty) firstDirtyAt = Date.now();
        dirty = true;
        return done;
      }
      start();
      return done;
    },
    dispose: () => {
      disposed = true;
      clear();
      // Nobody may hang on a refresh of a tree that is gone.
      for (const resolve of [...waitingForNext, ...waitingForCurrent]) resolve();
      waitingForNext = [];
      waitingForCurrent = [];
    },
    churn: () => churnCount,
  };
}
