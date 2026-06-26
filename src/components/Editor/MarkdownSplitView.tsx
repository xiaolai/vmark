/**
 * MarkdownSplitView — the side-by-side layout for the opt-in markdown split.
 *
 * Pure layout: an editable source pane (left) + a live read-only preview
 * (right) with a keyboard-resizable separator. Reuses SplitPaneEditor's CSS so
 * the markdown split looks identical to the other formats' split panes, but it
 * composes the real markdown SourceEditor + WYSIWYG preview (which the generic
 * SplitPaneEditor's SourcePane can't drive), so formatting targets the source.
 *
 * @module components/Editor/MarkdownSplitView
 */
import { useCallback, useState, type ReactNode, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import "./SplitPaneEditor/split-pane-editor.css";

const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.8;
const STEP = 0.05;
const DEFAULT_FRACTION = 0.5;

function clamp(n: number): number {
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, n));
}

export interface MarkdownSplitViewProps {
  source: ReactNode;
  preview: ReactNode;
}

export function MarkdownSplitView({ source, preview }: MarkdownSplitViewProps) {
  const { t } = useTranslation("editor");
  const [fraction, setFraction] = useState(DEFAULT_FRACTION);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFraction((f) => clamp(f - STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setFraction((f) => clamp(f + STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setFraction(MIN_FRACTION);
    } else if (e.key === "End") {
      e.preventDefault();
      setFraction(MAX_FRACTION);
    }
  }, []);

  return (
    <div
      className="split-pane-editor"
      data-format-id="markdown"
      style={{ "--split-pane-source-fraction": String(fraction) } as CSSProperties}
    >
      <div className="split-pane-editor__body">
        <div className="split-pane-editor__source">{source}</div>
        <div
          className="split-pane-editor__resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("splitPane.resize")}
          aria-valuemin={MIN_FRACTION * 100}
          aria-valuemax={MAX_FRACTION * 100}
          aria-valuenow={Math.round(fraction * 100)}
          tabIndex={0}
          onKeyDown={onKeyDown}
        />
        <div className="split-pane-editor__preview">{preview}</div>
      </div>
    </div>
  );
}
