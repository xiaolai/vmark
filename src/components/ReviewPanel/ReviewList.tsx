/**
 * Review list — the review panel's windowed row list: a fixed-height
 * scrolling viewport that mounts only the rows in view, so a document at
 * its review limit (600 live hunks) paints and scrolls as fast as one with
 * a handful.
 *
 * Key decisions:
 *   - Every row has the same height (`REVIEW_ROW_HEIGHT`), so a row's
 *     position is its index times that height and the window is two
 *     divisions: no measuring, no layout reads during render.
 *   - The viewport's height is fixed by the row count up to
 *     `REVIEW_VIEWPORT_HEIGHT`, never measured, so the window is right on
 *     the first render and in environments that do no layout.
 *   - A few rows either side of the view stay mounted (`OVERSCAN`), so a
 *     short scroll never shows an empty band before the next render.
 *   - The rows are a list whose items carry their position in the whole
 *     list (`aria-setsize`, `aria-posinset`), so a screen reader still
 *     hears "row 412 of 600" although only a window is mounted.
 *   - The window reads the last scroll offset clamped to the rows it has:
 *     a list that shrinks after a deep scroll still shows its last rows.
 *   - Hand-written rather than a virtualization dependency: one fixed row
 *     height needs a dozen lines, and the app ships no list virtualizer.
 *
 * @module components/ReviewPanel/ReviewList
 */

import { useState, type ReactNode } from "react";

/** One row, in px; the rows' CSS fills exactly this. */
const REVIEW_ROW_HEIGHT = 52;
/** The tallest the viewport grows, in px: five rows. */
const REVIEW_VIEWPORT_HEIGHT = REVIEW_ROW_HEIGHT * 5;
const OVERSCAN = 3;

interface Props<R> {
  rows: readonly R[];
  rowKey: (row: R) => string;
  renderRow: (row: R) => ReactNode;
  label: string;
}

export function ReviewList<R>({ rows, rowKey, renderRow, label }: Props<R>): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0);
  const height = Math.min(rows.length * REVIEW_ROW_HEIGHT, REVIEW_VIEWPORT_HEIGHT);
  // The last scroll may predate a shrink the browser clamped without a scroll event.
  const top = Math.min(scrollTop, Math.max(0, rows.length * REVIEW_ROW_HEIGHT - height));
  const first = Math.max(0, Math.floor(top / REVIEW_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + height) / REVIEW_ROW_HEIGHT) + OVERSCAN);

  return (
    <div className="review-list vm-scroll--thin" style={{ height }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} data-testid="review-list">
      <div role="list" aria-label={label} className="review-list__canvas" style={{ height: rows.length * REVIEW_ROW_HEIGHT }}>
        {rows.slice(first, last).map((row, i) => (
          <div
            key={rowKey(row)}
            role="listitem"
            aria-setsize={rows.length}
            aria-posinset={first + i + 1}
            className="review-list__row"
            style={{ top: (first + i) * REVIEW_ROW_HEIGHT, height: REVIEW_ROW_HEIGHT }}
          >
            {renderRow(row)}
          </div>
        ))}
      </div>
    </div>
  );
}
