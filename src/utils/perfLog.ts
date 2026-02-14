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
    return false;
  }
};

const startTimes = new Map<string, number>();
const marks = new Map<string, number>();

// Session start time for absolute timestamps
let sessionStart = 0;

export function perfReset(): void {
  sessionStart = performance.now();
  startTimes.clear();
  marks.clear();
  if (PERF_ENABLED()) {
    console.log("\n%c═══ PERF SESSION START ═══", "color: #0066cc; font-weight: bold");
  }
}

export function perfStart(label: string): void {
  if (!PERF_ENABLED()) return;
  startTimes.set(label, performance.now());
}

export function perfEnd(label: string, details?: Record<string, unknown>): void {
  if (!PERF_ENABLED()) return;
  const start = startTimes.get(label);
  if (start === undefined) {
    console.warn(`[PERF] No start time for: ${label}`);
    return;
  }
  const elapsed = performance.now() - start;
  const absolute = sessionStart ? performance.now() - sessionStart : 0;

  const detailStr = details ? ` | ${JSON.stringify(details)}` : "";
  const color = elapsed > 100 ? "color: #cf222e" : elapsed > 50 ? "color: #9a6700" : "color: #1a7f37";

  console.log(
    `%c[PERF] ${label}: ${elapsed.toFixed(1)}ms (T+${absolute.toFixed(0)}ms)${detailStr}`,
    color
  );
  startTimes.delete(label);
}

export function perfMark(label: string, details?: Record<string, unknown>): void {
  if (!PERF_ENABLED()) return;
  const now = performance.now();
  const absolute = sessionStart ? now - sessionStart : 0;
  marks.set(label, now);

  const detailStr = details ? ` | ${JSON.stringify(details)}` : "";
  console.log(`%c[PERF] ▸ ${label} (T+${absolute.toFixed(0)}ms)${detailStr}`, "color: #666");
}

export function perfSince(label: string, sinceLabel: string): void {
  if (!PERF_ENABLED()) return;
  const since = marks.get(sinceLabel);
  const now = performance.now();
  if (since === undefined) {
    console.warn(`[PERF] No mark for: ${sinceLabel}`);
    return;
  }
  const elapsed = now - since;
  const absolute = sessionStart ? now - sessionStart : 0;
  const color = elapsed > 100 ? "color: #cf222e" : elapsed > 50 ? "color: #9a6700" : "color: #1a7f37";

  console.log(
    `%c[PERF] ${label} (since ${sinceLabel}): ${elapsed.toFixed(1)}ms (T+${absolute.toFixed(0)}ms)`,
    color
  );
}

export function perfLog(message: string, details?: Record<string, unknown>): void {
  if (!PERF_ENABLED()) return;
  const absolute = sessionStart ? performance.now() - sessionStart : 0;
  const detailStr = details ? ` | ${JSON.stringify(details)}` : "";
  console.log(`%c[PERF] ${message} (T+${absolute.toFixed(0)}ms)${detailStr}`, "color: #666");
}

// Auto-reset on module load
perfReset();
