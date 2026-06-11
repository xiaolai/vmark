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
 *   - useDeferredValue keeps typing responsive when content is large.
 *   - Renders two <span> elements inside a button that toggles the
 *     WordCountPopover (full metrics breakdown, geared toward CJK 字数).
 *
 * @coordinates-with StatusBar.tsx — no longer subscribes to document content
 * @coordinates-with StatusBarRight.tsx — renders this component for counts
 * @coordinates-with WordCountPopover.tsx — the expanded metrics breakdown
 * @module components/StatusBar/StatusBarCounts
 */

import { memo, useDeferredValue, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentContent, useDocumentSelectedText } from "@/hooks/useDocumentState";
import { countCharsFromPlain, countWordsFromPlain, stripMarkdown } from "./statusTextMetrics";
import { WordCountPopover } from "./WordCountPopover";
import "./status-bar-counts.css";

/** Isolated component displaying word/char counts; switches to "selected / total" when text is selected. */
export const StatusBarCounts = memo(function StatusBarCounts() {
  const { t } = useTranslation("statusbar");
  const content = useDocumentContent();
  const selectedText = useDocumentSelectedText();
  const deferredContent = useDeferredValue(content);
  const deferredSelected = useDeferredValue(selectedText);

  const strippedContent = useMemo(() => stripMarkdown(deferredContent), [deferredContent]);
  const totalWords = useMemo(() => countWordsFromPlain(strippedContent), [strippedContent]);
  const totalChars = useMemo(() => countCharsFromPlain(strippedContent), [strippedContent]);

  const strippedSelected = useMemo(
    () => stripMarkdown(deferredSelected),
    [deferredSelected]
  );
  const selectedWords = useMemo(
    () => countWordsFromPlain(strippedSelected),
    [strippedSelected]
  );
  const selectedChars = useMemo(
    () => countCharsFromPlain(strippedSelected),
    [strippedSelected]
  );

  // Detect selection from raw, trimmed text. Whitespace-only selections
  // (cursor moved across spaces) read as no selection, but selections of
  // pure markdown syntax (e.g. "**") still register as a real selection
  // even though they strip to an empty string for counting.
  const hasSelection = deferredSelected.trim().length > 0;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
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
            ? t("wordsSelected", { selected: selectedWords, total: totalWords })
            : t("words", { count: totalWords })}
        </span>
        <span className="status-item">
          {hasSelection
            ? t("charsSelected", { selected: selectedChars, total: totalChars })
            : t("chars", { count: totalChars })}
        </span>
      </button>
      {open && (
        <WordCountPopover
          anchorRef={triggerRef}
          content={deferredContent}
          selectedText={deferredSelected}
          hasSelection={hasSelection}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
});
