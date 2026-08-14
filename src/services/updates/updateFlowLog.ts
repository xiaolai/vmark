/**
 * Update-flow milestone logging, visible in RELEASE builds.
 *
 * Purpose: record the update state machine's transitions to the log file a
 *   user can actually send with a bug report.
 *
 * Why this is not `updateLog` in `utils/debug.ts`:
 *   The debug tier compiles to a no-op in production. The update flow had no
 *   milestone logging of ANY tier, so a report like "clicked update and the
 *   app froze" (#1270) arrives with nothing describing which step stalled —
 *   the same dead end that #1253 hit for window close, where the lines existed
 *   but had been compiled out. Either way the user's log cannot answer the one
 *   question that matters: which await never returned.
 *
 *   Routes to `update_log`, which is `info!`, rather than `debug_log`, which is
 *   `debug!` and is filtered at the release Info level.
 *
 * A sibling command rather than a generalised one: `window_close_log` shipped
 * two days before this for an unresolved report, and rewriting its command
 * surface to save three lines of Rust would destabilise the diagnostic being
 * relied on to investigate a sibling stall. If a third flow needs this,
 * generalise then — with all three in hand.
 *
 * Kept to state transitions, not per-chunk noise: a download emits progress
 * events continuously and those are deliberately NOT logged here.
 *
 * @coordinates-with src-tauri/src/app_setup.rs — update_log command
 * @coordinates-with useUpdateOperations.ts — the transitions being recorded
 * @module services/updates/updateFlowLog
 */

import { invoke } from "@tauri-apps/api/core";
import { updateSyncWarn } from "@/utils/debug";

/**
 * Record one update-flow milestone at INFO in the file log.
 *
 * Fire-and-forget: logging must never be able to fail an update. A rejected
 * invoke is swallowed in production and surfaced only in dev.
 */
export function updateFlowLog(label: string, ...args: unknown[]): void {
  const detail = args
    .map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a) : String(a)))
    .join(" ");
  const message = detail ? `[${label}] ${detail}` : `[${label}]`;

  invoke("update_log", { message }).catch((e) => {
    /* v8 ignore start -- @preserve reason: import.meta.env.DEV is true under vitest; the production branch is never taken */
    if (import.meta.env.DEV) {
      updateSyncWarn("update_log invoke failed:", e);
    }
    /* v8 ignore stop */
  });
}
