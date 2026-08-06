/**
 * resolveBufferLine
 *
 * Purpose: Map a mouse event's viewport position onto an xterm BUFFER line
 * (WI-4.4). "Copy Command Output" needs to know which command the user
 * right-clicked, and xterm exposes no public hit-test — only the geometry
 * needed to compute one.
 *
 * Key decisions:
 *   - Derives the row from the pointer's offset within the terminal's screen
 *     element divided by the measured row height, then adds `viewportY` to
 *     convert a viewport row into an absolute buffer line (the two differ by
 *     however far the user has scrolled back).
 *   - Returns undefined rather than a guess when the geometry is unavailable
 *     (no element, zero height). The caller then simply omits the menu item —
 *     a wrong line would copy the wrong command's output, which is worse than
 *     not offering the action.
 *
 * @coordinates-with TerminalPanel.tsx — sole caller, on right-click
 * @coordinates-with setupOsc.ts — commandOutputRange consumes the line
 * @module components/Terminal/resolveBufferLine
 */
import type { Terminal } from "@xterm/xterm";

/** A mouse-ish event carrying viewport coordinates. */
interface PointerLike {
  clientY: number;
}

/**
 * The absolute buffer line under `event`, or undefined when it cannot be
 * determined. Clamped to the buffer so a click in the panel's padding still
 * resolves to a real row.
 */
export function resolveBufferLineFromEvent(
  term: Terminal | undefined | null,
  event: PointerLike,
): number | undefined {
  if (!term) return undefined;
  // `element` is the terminal's root; `rows` and the measured height give the
  // row pitch without reaching into xterm's private renderer.
  const element = term.element;
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0 || term.rows <= 0) return undefined;

  const rowHeight = rect.height / term.rows;
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return undefined;

  const viewportRow = Math.floor((event.clientY - rect.top) / rowHeight);
  const clampedRow = Math.min(Math.max(viewportRow, 0), term.rows - 1);

  const buffer = term.buffer.active;
  const line = buffer.viewportY + clampedRow;
  // Never point past the end of the buffer.
  return Math.min(Math.max(line, 0), Math.max(buffer.length - 1, 0));
}
