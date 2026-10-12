/**
 * floatingPromptRange — decide which buffer rows the floating prompt mirrors
 * while the user reads scrollback, so they can keep typing without losing
 * their place.
 *
 * Purpose: A terminal's "input bar" is just the rows around the cursor. Once
 * the viewport scrolls back far enough, those rows leave the screen. This pure
 * helper answers "is the cursor off-screen, and if so which rows hold the
 * input?" from the public buffer API alone.
 *
 * Key decisions:
 *   - Normal buffer only. The alternate screen (vim, less, full-screen TUIs)
 *     has no scrollback, so the viewport can never leave its cursor.
 *   - The range starts at the first row of the cursor's LOGICAL line (walking
 *     up `isWrapped`), so a long command that wrapped is mirrored whole.
 *   - One non-blank row above it is kept as context: a two-line shell prompt's
 *     first line, or the top border of an inline TUI input box (Claude Code).
 *   - It extends DOWN to the last non-blank screen row, which picks up a TUI
 *     box's bottom border and footer while a plain shell (blank below the
 *     prompt) stays one row.
 *   - Capped at `maxRows`: trimmed from the top first (down to the cursor's
 *     row), then from the bottom — the cursor row is never cut.
 *
 * @coordinates-with setupFloatingPrompt.ts — sole caller
 * @module components/Terminal/floatingPromptRange
 */

import type { Terminal } from "@xterm/xterm";

/** Absolute buffer rows to mirror, inclusive, plus the cursor's own row. */
export interface FloatingPromptRange {
  start: number;
  end: number;
  cursorRow: number;
}

/** Default cap when the caller does not pass one. */
const DEFAULT_MAX_ROWS = 6;

type TermLike = Pick<Terminal, "rows"> & { buffer: Pick<Terminal["buffer"], "active"> };

function isBlankRow(term: TermLike, row: number): boolean {
  const line = term.buffer.active.getLine(row);
  return !line || line.translateToString(true).trim() === "";
}

/**
 * The rows to mirror, or null when no floating prompt should show (at the
 * bottom, on the alternate screen, or with the cursor still in view).
 */
export function resolveFloatingPromptRange(
  term: TermLike,
  options: { maxRows?: number } = {},
): FloatingPromptRange | null {
  const buffer = term.buffer.active;
  if (buffer.type !== "normal") return null;
  if (buffer.viewportY >= buffer.baseY) return null;

  const cursorRow = buffer.baseY + buffer.cursorY;
  const viewportEnd = buffer.viewportY + term.rows - 1;
  if (cursorRow >= buffer.viewportY && cursorRow <= viewportEnd) return null;

  let start = cursorRow;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  if (start > 0 && !isBlankRow(term, start - 1)) start--;

  let end = cursorRow;
  for (let row = buffer.baseY + term.rows - 1; row > cursorRow; row--) {
    if (!isBlankRow(term, row)) {
      end = row;
      break;
    }
  }

  const maxRows = Math.max(1, Math.trunc(options.maxRows ?? DEFAULT_MAX_ROWS));
  if (end - start + 1 > maxRows) start = Math.max(start, cursorRow - (maxRows - 1));
  if (end - start + 1 > maxRows) end = start + maxRows - 1;

  return { start, end, cursorRow };
}
