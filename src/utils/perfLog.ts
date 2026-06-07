/**
 * Performance Logging Utility
 *
 * Purpose: Opt-in performance timing for diagnosing load times and bottlenecks.
 * Enable via: localStorage.setItem('PERF_LOG', 'true')
 *
 * Key decisions:
 *   - Gated behind localStorage flag — zero overhead in normal usage
 *   - Color-coded output: green (<50ms), yellow (50-100ms), red (>100ms)
 *   - Session-relative timestamps (T+Nms) for correlating events
 *   - Auto-resets on module load to start fresh each page load
 *
 * @coordinates-with markdownPipeline/adapter.ts — parse/serialize timing
 * @coordinates-with markdownPipeline/parser.ts — remark step timing
 * @coordinates-with mdastToProseMirror.ts — MDAST→PM conversion timing
 * @module utils/perfLog
 */

const PERF_ENABLED = () => {
  try {
    return localStorage.getItem("PERF_LOG") === "true";
  } catch {
    /* v8 ignore next -- @preserve localStorage throws only in restricted environments (e.g. sandboxed iframes); not reproducible in unit tests */
    return false;
  }
};

const startTimes = new Map<string, number>();

// Session start time for absolute timestamps
let sessionStart = 0;

/** Reset the perf session timer and clear all pending start times. */
export function perfReset(): void {
  sessionStart = performance.now();
  startTimes.clear();
  if (PERF_ENABLED()) {
    console.log("\n%c═══ PERF SESSION START ═══", "color: #0066cc; font-weight: bold");
  }
}

/** Record the start time for a labeled performance measurement. */
export function perfStart(label: string): void {
  if (!PERF_ENABLED()) return;
  startTimes.set(label, performance.now());
}

/** End a labeled measurement and log the elapsed time with color-coded output. */
export function perfEnd(label: string, details?: Record<string, unknown>): void {
  if (!PERF_ENABLED()) return;
  const start = startTimes.get(label);
  if (start === undefined) {
    // Diagnostic warning, styled like the rest of perfLog's %c output (red).
    // Stays inside the PERF_ENABLED() gate above, so zero overhead unless opted in.
    console.log(`%c[PERF] No start time for: ${label}`, "color: #cf222e");
    return;
  }
  const elapsed = performance.now() - start;
  /* v8 ignore next -- @preserve sessionStart is always set by auto-running perfReset() on module load; 0 fallback is unreachable */
  const absolute = sessionStart ? performance.now() - sessionStart : 0;

  const detailStr = details ? ` | ${JSON.stringify(details)}` : "";
  const color = elapsed > 100 ? "color: #cf222e" : elapsed > 50 ? "color: #9a6700" : "color: #1a7f37";

  console.log(
    `%c[PERF] ${label}: ${elapsed.toFixed(1)}ms (T+${absolute.toFixed(0)}ms)${detailStr}`,
    color
  );
  startTimes.delete(label);
}

/** Log a point-in-time performance marker with session-relative timestamp. */
export function perfMark(label: string, details?: Record<string, unknown>): void {
  if (!PERF_ENABLED()) return;
  const now = performance.now();
  /* v8 ignore next -- @preserve sessionStart is always set by auto-running perfReset() on module load; 0 fallback is unreachable */
  const absolute = sessionStart ? now - sessionStart : 0;
  const detailStr = details ? ` | ${JSON.stringify(details)}` : "";
  console.log(`%c[PERF] ▸ ${label} (T+${absolute.toFixed(0)}ms)${detailStr}`, "color: #666");
}

// Auto-reset on module load
perfReset();
