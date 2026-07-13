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

/** Convert store line ending format to hot exit format. */
export function toHotExitLineEnding(lineEnding: StoreLineEnding): '\n' | '\r\n' | 'unknown' {
  switch (lineEnding) {
    case 'lf':
      return '\n';
    case 'crlf':
      return '\r\n';
    case 'unknown':
      return 'unknown';
    default:
      // Exhaustiveness guard for future enum additions
      return 'unknown';
  }
}

/** Convert store cursor info to hot exit format. */
export function toHotExitCursorInfo(cursorInfo: StoreCursorInfo | null | undefined): CursorInfo | null {
  if (!cursorInfo) return null;
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

/** Extract the untitled number from a tab title like "Untitled-5". */
export function extractUntitledNumber(title: string): number | null {
  const match = title.match(/^Untitled-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}
