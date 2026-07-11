/**
 * WordCountPopover
 *
 * Purpose: Click-to-expand metrics breakdown for the status-bar word/char
 * counts. Surfaces a full set of figures — Words, Characters (with/without
 * spaces), CJK characters (字数), and Characters (no punctuation) — aimed
 * especially at CJK writers who track 字数 rather than English word count.
 *
 * Key decisions:
 *   - Anchored ABOVE the status bar via position: fixed (the status bar sits
 *     at the bottom of the window), mirroring McpHistoryButton's popover.
 *   - Pure presentational: receives precomputed TextMetrics (totals + selected)
 *     from StatusBarCounts, so strip+compute happens once at the source and the
 *     inline counts and this breakdown never diverge. Self-positions via a layout
 *     effect (measuring the anchor before paint) rather than reading the anchor
 *     rect during render, which is not concurrent-safe.
 *   - When a selection exists, each row shows "selected / total"; otherwise a
 *     single total — matching the inline counts' selected/total convention.
 *   - Open state and dismiss (outside click / Escape) are owned by
 *     StatusBarCounts, whose wrapper element contains both trigger and popover.
 *
 * @coordinates-with StatusBarCounts.tsx — owns open state, anchor ref, dismiss
 * @coordinates-with statusTextMetrics.ts — TextMetrics shape
 * @module components/StatusBar/WordCountPopover
 */

import type { RefObject } from "react";
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextMetrics } from "./statusTextMetrics";
import "./word-count-popover.css";

const POPUP_WIDTH = 260;

interface WordCountPopoverProps {
  /** The trigger element, used to position the popover above it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Precomputed metrics for the whole document. */
  totals: TextMetrics;
  /** Precomputed metrics for the current selection. */
  selected: TextMetrics;
  /** Whether a real (non-whitespace) selection is active. */
  hasSelection: boolean;
}

/** One metric to render: an i18n label key and its metric field. */
const METRIC_ROWS: ReadonlyArray<{ key: string; field: keyof TextMetrics }> = [
  { key: "wordCountWords", field: "words" },
  { key: "wordCountChars", field: "charsWithSpaces" },
  { key: "wordCountCharsNoSpaces", field: "charsNoSpaces" },
  { key: "wordCountCjkChars", field: "cjkChars" },
  { key: "wordCountCharsNoPunctuation", field: "charsNoPunctuation" },
];

/** Metrics breakdown popover anchored above the status bar. */
export function WordCountPopover({
  anchorRef,
  totals,
  selected,
  hasSelection,
}: WordCountPopoverProps): React.ReactElement {
  const { t } = useTranslation("statusbar");

  // Position above the anchor by measuring it in a layout effect (before paint),
  // rather than reading the anchor rect during render — the latter is not
  // concurrent-safe (#1063). No deps: remeasure every render (the trigger width
  // shifts as counts change while open); the functional update bails when nothing
  // moved, so there is no render loop.
  const [style, setStyle] = useState<React.CSSProperties>({ right: 8, bottom: 8, width: POPUP_WIDTH });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: remeasure every render (see note above); functional setState bails when unchanged, so no loop.
  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const right = Math.max(8, window.innerWidth - rect.right);
    const bottom = Math.max(8, window.innerHeight - rect.top + 6);
    setStyle((prev) =>
      prev.right === right && prev.bottom === bottom ? prev : { right, bottom, width: POPUP_WIDTH },
    );
  });

  return (
    <div
      className="word-count-popover"
      style={style}
      role="dialog"
      aria-label={t("wordCountTitle")}
    >
      <header className="word-count-popover__header">
        <span className="word-count-popover__title">{t("wordCountTitle")}</span>
      </header>
      <dl className="word-count-popover__list">
        {METRIC_ROWS.map(({ key, field }) => (
          <div key={field} className="word-count-popover__row">
            <dt className="word-count-popover__label">{t(key)}</dt>
            <dd
              className="word-count-popover__value"
              data-testid={`metric-${field}`}
            >
              {hasSelection
                ? `${selected[field].toLocaleString()} / ${totals[field].toLocaleString()}`
                : totals[field].toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
