/**
 * HTML preview zoom — the pure arithmetic behind the zoom controls (issue #1704).
 *
 * Purpose: hold the supported range and step as constants, and step a level by
 * one increment, clamped. Kept separate from the component so both the bar
 * (which disables its buttons at the ends) and the preview (which applies the
 * factor to the frame) read one source of truth for the limits.
 *
 * Levels are integer PERCENTS (100, 110, …) rather than factors: stepping a
 * percent by a fixed integer never accumulates floating-point drift, so the
 * reset-disabled check (`=== 100`) and the label stay exact.
 *
 * @module lib/formats/adapters/htmlZoom
 */

export const HTML_ZOOM_MIN_PERCENT = 50;
export const HTML_ZOOM_MAX_PERCENT = 400;
export const HTML_ZOOM_STEP_PERCENT = 10;
export const HTML_ZOOM_DEFAULT_PERCENT = 100;

/** Step one increment in the given direction, clamped to the supported range. */
export function stepZoomPercent(current: number, direction: -1 | 1): number {
  const next = current + direction * HTML_ZOOM_STEP_PERCENT;
  return Math.min(HTML_ZOOM_MAX_PERCENT, Math.max(HTML_ZOOM_MIN_PERCENT, next));
}
