/**
 * Update download progress throttle.
 *
 * The Tauri updater fires a `Progress` event for every network chunk. Writing
 * the store on each one floods React re-renders AND the cross-window broadcast
 * (one `emit` per chunk — the cascade behind the v0.7.11 freeze). We coalesce
 * writes to at most one per whole percent (determinate downloads) or per
 * ~512 KB (indeterminate — server sent no Content-Length). The caller's
 * `Finished` handler always writes the final value, so a dropped trailing tick
 * is harmless.
 *
 * @module hooks/updateProgressThrottle
 */

/** Indeterminate-download write cadence (no total → percent is meaningless). */
export const INDETERMINATE_STEP_BYTES = 512 * 1024;

/**
 * Whether a progress tick at `downloaded` bytes is worth a store write, given
 * the last-written byte count (`lastWritten`, or < 0 if nothing written yet)
 * and the total size (`null` when unknown).
 */
export function shouldWriteProgress(
  downloaded: number,
  lastWritten: number,
  total: number | null,
): boolean {
  if (lastWritten < 0) return true;
  if (total && total > 0) {
    return (
      Math.floor((downloaded / total) * 100) !==
      Math.floor((lastWritten / total) * 100)
    );
  }
  return downloaded - lastWritten >= INDETERMINATE_STEP_BYTES;
}
