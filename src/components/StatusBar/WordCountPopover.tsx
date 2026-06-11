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
 *   - Receives raw content/selection strings and strips markdown + computes
 *     metrics itself, so the trigger (StatusBarCounts) stays a thin toggle.
 *   - When a selection exists, each row shows "selected / total"; otherwise a
 *     single total — matching the inline counts' selected/total convention.
 *   - Dismiss is delegated to useDismissOnOutsideOrEscape (deferred activation
 *     so the opening click doesn't immediately close it).
 *
 * @coordinates-with StatusBarCounts.tsx — owns the open state + anchor ref
 * @coordinates-with statusTextMetrics.ts — computeTextMetrics + stripMarkdown
 * @module components/StatusBar/WordCountPopover
 */

import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { computeTextMetrics, stripMarkdown } from "./statusTextMetrics";
import type { TextMetrics } from "./statusTextMetrics";
import "./word-count-popover.css";

const POPUP_WIDTH = 260;

interface WordCountPopoverProps {
  /** The trigger element, used to position the popover above it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Raw (markdown) document content. */
  content: string;
  /** Raw (markdown) selected text. */
  selectedText: string;
  /** Whether a real (non-whitespace) selection is active. */
  hasSelection: boolean;
  /** Called when the popover should close (Escape / outside click). */
  onClose: () => void;
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
  content,
  selectedText,
  hasSelection,
  onClose,
}: WordCountPopoverProps): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const popoverRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideOrEscape(true, popoverRef, onClose, {
    deferActivation: true,
  });

  const totals = useMemo(
    () => computeTextMetrics(stripMarkdown(content)),
    [content],
  );
  const selected = useMemo(
    () => computeTextMetrics(stripMarkdown(selectedText)),
    [selectedText],
  );

  const position = (): React.CSSProperties => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) {
      return { right: 8, bottom: 8, width: POPUP_WIDTH };
    }
    const right = Math.max(8, window.innerWidth - rect.right);
    const bottom = Math.max(8, window.innerHeight - rect.top + 6);
    return { right, bottom, width: POPUP_WIDTH };
  };

  return (
    <div
      ref={popoverRef}
      className="word-count-popover"
      style={position()}
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
