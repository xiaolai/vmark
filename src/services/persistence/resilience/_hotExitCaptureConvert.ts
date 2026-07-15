/**
 * Hot-exit capture converters.
 *
 * Purpose: the pure store-shape → hot-exit-payload conversions used by
 * `_hotExitCapture`. Extracted so the capture module stays inside the file-size
 * limit; no store access, no side effects.
 *
 * @coordinates-with _hotExitCapture.ts — sole caller
 * @module services/persistence/resilience/_hotExitCaptureConvert
 */

import type { CursorInfo } from '../hotExit/types';
import type { LineEnding as StoreLineEnding } from '@/utils/linebreakDetection';
import type {
  HistoryCheckpoint as StoreHistoryCheckpoint,
  CursorInfo as StoreCursorInfo,
} from '@/stores/documentStore';

/** Largest value Rust's `u32` accepts. */
const U32_MAX = 0xffff_ffff;

/** True for an integer in `[0, u32::MAX]` — the range Rust's `u32` accepts. */
function isU32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= U32_MAX;
}

/** Convert store line ending format to hot exit format. */
export function toHotExitLineEnding(lineEnding: StoreLineEnding): '\n' | '\r\n' | 'unknown' {
  switch (lineEnding) {
    case 'lf':
      return '\n';
    case 'crlf':
      return '\r\n';
    case 'unknown':
      return 'unknown';
    default: {
      // Compile-time exhaustiveness: a new StoreLineEnding variant fails to
      // assign to `never` here. Runtime still degrades to 'unknown' rather than
      // throwing — an exception during capture would lose the whole window.
      const _exhaustive: never = lineEnding;
      void _exhaustive;
      return 'unknown';
    }
  }
}

/**
 * Convert store cursor info to hot exit format.
 *
 * Rust's `CursorInfo` requires bounded numerics (`u32` line/offset, finite
 * `f32` percent). A negative, fractional, non-finite, or oversized value makes
 * serde reject the ENTIRE capture response — losing the window's recovery. When
 * any numeric field is out of range, drop only the cursor (return `null`); a
 * missing cursor position is recoverable, a lost window is not.
 */
export function toHotExitCursorInfo(cursorInfo: StoreCursorInfo | null | undefined): CursorInfo | null {
  if (!cursorInfo) return null;
  if (
    !isU32(cursorInfo.sourceLine) ||
    !isU32(cursorInfo.offsetInWord) ||
    !Number.isFinite(cursorInfo.percentInLine)
  ) {
    return null;
  }
  return {
    source_line: cursorInfo.sourceLine,
    word_at_cursor: cursorInfo.wordAtCursor,
    offset_in_word: cursorInfo.offsetInWord,
    node_type: cursorInfo.nodeType,
    percent_in_line: cursorInfo.percentInLine,
    context_before: cursorInfo.contextBefore,
    context_after: cursorInfo.contextAfter,
    block_anchor: cursorInfo.blockAnchor,
  };
}

/** Convert store history checkpoint to hot exit format. */
export function toHotExitCheckpoint(checkpoint: StoreHistoryCheckpoint) {
  return {
    markdown: checkpoint.markdown,
    mode: checkpoint.mode,
    cursor_info: toHotExitCursorInfo(checkpoint.cursorInfo),
    timestamp: checkpoint.timestamp,
  };
}

/** Extract the untitled number from a tab title like "Untitled-5".
 *
 * Persisted as Rust `Option<u32>`: a value past the `u32` (or JS safe-integer)
 * range makes serde reject the whole capture response, so an out-of-range
 * suffix is treated as "no untitled number" (`null`) rather than forwarded. */
export function extractUntitledNumber(title: string): number | null {
  const match = title.match(/^Untitled-(\d+)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > U32_MAX) return null;
  return value;
}
