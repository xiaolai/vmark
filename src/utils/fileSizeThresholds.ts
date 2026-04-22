/**
 * File Size Thresholds
 *
 * Purpose: Centralizes the byte thresholds that decide how VMark handles a
 * file at open time. Byte count is a coarse proxy for the real bottleneck
 * (ProseMirror view construction, which scales with block count), but it is
 * free to compute via `fs::metadata` while block count requires parsing.
 * The tiers below are calibrated against the 1.4 MB / 2,250-block corpus
 * from `dev-docs/plans/20260422-large-file-open-ux.md`.
 *
 * Tier semantics:
 *   - "small"   → default WYSIWYG open, no indicator.
 *   - "large"   → opens in Source mode by default (sub-second open).
 *                 StatusBar offers an explicit upgrade to WYSIWYG.
 *   - "huge"    → pre-open warning dialog; Open proceeds to Source mode only.
 *   - "refused" → no open attempt; liability floor for webview memory safety.
 *
 * @coordinates-with hooks/useFinderFileOpen.ts — routes pre-read on size tier.
 * @coordinates-with hooks/useFileOpen.ts — shared open helper consults tier.
 * @coordinates-with stores/settingsStore.ts — user-togglable thresholds honor
 *   `largeFile.autoSourceMode` and `largeFile.warnAbove5MB`.
 * @module utils/fileSizeThresholds
 */

/** Byte thresholds. Values are conservative defaults; revisit with more corpora. */
export const FILE_SIZE_THRESHOLDS = {
  /** Below this size the open is perceptually instant; no indicator needed. */
  SHOW_PROGRESS_BYTES: 300 * 1024,
  /** At or above this, auto-route to Source mode (user-togglable). */
  SOURCE_MODE_DEFAULT_BYTES: 1024 * 1024,
  /** At or above this, confirm with a pre-open dialog (user-togglable). */
  WARN_BEFORE_OPEN_BYTES: 5 * 1024 * 1024,
  /** Hard refusal floor. Not user-togglable. */
  HARD_REFUSE_BYTES: 50 * 1024 * 1024,
} as const;

export type FileSizeTier = "small" | "large" | "huge" | "refused";

/**
 * Classify a file size into its UX tier.
 *
 * @param bytes Raw byte count from `fs::metadata`. Non-finite and negative
 *   values are treated as "small" — the caller will run the existing error
 *   path when the subsequent read fails.
 */
export function classifyFileSize(bytes: number): FileSizeTier {
  if (!Number.isFinite(bytes) || bytes < 0) return "small";
  if (bytes >= FILE_SIZE_THRESHOLDS.HARD_REFUSE_BYTES) return "refused";
  if (bytes >= FILE_SIZE_THRESHOLDS.WARN_BEFORE_OPEN_BYTES) return "huge";
  if (bytes >= FILE_SIZE_THRESHOLDS.SOURCE_MODE_DEFAULT_BYTES) return "large";
  return "small";
}

/** Whether the indeterminate open indicator should appear for this size. */
export function shouldShowProgressIndicator(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= FILE_SIZE_THRESHOLDS.SHOW_PROGRESS_BYTES;
}

/** Human-readable file size with 1-decimal precision (SI/power-of-two hybrid used by macOS Finder). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
}
