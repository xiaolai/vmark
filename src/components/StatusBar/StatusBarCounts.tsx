/**
 * StatusBarCounts
 *
 * Purpose: Isolated component that subscribes to document content + selection
 * and computes word/character counts. Shows "selected / total" when a
 * selection exists, total-only otherwise. Isolated so the parent StatusBar
 * doesn't re-render on every keystroke or selection change.
 *
 * Key decisions:
 *   - Owns useDocumentContent() and useDocumentSelectedText() subscriptions
 *   - Selection counts are computed via stripMarkdown so a selection in
 *     Source mode (raw markdown) yields the same count as in WYSIWYG.
 *   - Computes the full TextMetrics ONCE (totals + selected, memoized) and
 *     drives both the inline display and the WordCountPopover from them, so
 *     inline and popover figures never diverge and the strip+compute work
 *     isn't duplicated.
 *   - Totals AND selection go through per-instance segment caches
 *     (incrementalTextMetrics) so a content flush recomputes only edited
 *     blocks — the direct pipeline is O(document) per flush (~480 ms on a
 *     ~1.9M-char CJK doc). Sharing one pipeline for both also guarantees the
 *     popover can never show a selected count exceeding its total (the two
 *     pipelines differ in documented charsWithSpaces edge semantics).
 *   - Owns the popover dismiss: trigger + popover live inside one wrapper, and
 *     useDismissOnOutsideOrEscape gates on the wrapper, so clicking the trigger
 *     while open counts as "inside" and the trigger toggle closes cleanly.
 *   - useDeferredValue keeps typing responsive when content is large.
 *   - Renders two <span> elements inside a button that toggles the
 *     WordCountPopover (full metrics breakdown, geared toward CJK 字数).
 *
 * @coordinates-with StatusBar.tsx — no longer subscribes to document content
 * @coordinates-with StatusBarRight.tsx — renders this component for counts
 * @coordinates-with WordCountPopover.tsx — the expanded metrics breakdown
 * @module components/StatusBar/StatusBarCounts
 */

import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentContent, useDocumentSelectedText } from "@/hooks/useDocumentState";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { createMetricsCache } from "./incrementalTextMetrics";
import { WordCountPopover } from "./WordCountPopover";
import "./status-bar-counts.css";

/** Isolated component displaying word/char counts; switches to "selected / total" when text is selected. */
export const StatusBarCounts = memo(function StatusBarCounts() {
  const { t } = useTranslation("statusbar");
  const content = useDocumentContent();
  const selectedText = useDocumentSelectedText();
  const deferredContent = useDeferredValue(content);
  const deferredSelected = useDeferredValue(selectedText);

  // Compute the full metric breakdown ONCE for totals and selection. Both the
  // inline display and the popover read from these, so they can never diverge.
  // Totals and selection each use a per-instance segment cache so only edited
  // blocks recompute — and both share ONE pipeline's semantics, so a full-doc
  // selection always equals the totals. The caches mutate internal generation
  // maps during render; that is safe under discarded/replayed concurrent
  // renders because a stale generation only costs a redundant recompute — it
  // can never produce wrong numbers.
  const totalsCacheRef = useRef<ReturnType<typeof createMetricsCache> | null>(null);
  totalsCacheRef.current ??= createMetricsCache();
  const computeTotals = totalsCacheRef.current;
  const selectedCacheRef = useRef<ReturnType<typeof createMetricsCache> | null>(null);
  selectedCacheRef.current ??= createMetricsCache();
  const computeSelected = selectedCacheRef.current;
  const totals = useMemo(
    () => computeTotals(deferredContent),
    [computeTotals, deferredContent]
  );
  const selected = useMemo(
    () => computeSelected(deferredSelected),
    [computeSelected, deferredSelected]
  );

  // Detect selection from raw, trimmed text. Whitespace-only selections
  // (cursor moved across spaces) read as no selection, but selections of
  // pure markdown syntax (e.g. "**") still register as a real selection
  // even though they strip to an empty string for counting.
  const hasSelection = deferredSelected.trim().length > 0;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The wrapper contains BOTH the trigger and the popover. Because position:
  // fixed doesn't change the DOM tree, the popover is still a descendant, so
  // wrapper.contains(popover) is true — clicks on the trigger or the popover
  // count as "inside" and only genuine outside clicks dismiss.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismissOnOutsideOrEscape(open, wrapperRef, close, {
    deferActivation: true,
  });

  return (
    <div ref={wrapperRef} className="status-counts-wrapper">
      <button
        ref={triggerRef}
        type="button"
        className="status-counts-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("wordCountTrigger")}
        title={t("wordCountTrigger")}
      >
        <span className="status-item">
          {hasSelection
            ? t("wordsSelected", { selected: selected.words, total: totals.words })
            : t("words", { count: totals.words })}
        </span>
        <span className="status-item">
          {hasSelection
            ? t("charsSelected", {
                selected: selected.charsNoSpaces,
                total: totals.charsNoSpaces,
              })
            : t("chars", { count: totals.charsNoSpaces })}
        </span>
      </button>
      {open && (
        <WordCountPopover
          anchorRef={triggerRef}
          totals={totals}
          selected={selected}
          hasSelection={hasSelection}
        />
      )}
    </div>
  );
});
