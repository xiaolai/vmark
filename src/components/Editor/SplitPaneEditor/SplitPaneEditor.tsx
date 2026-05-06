// WI-1A.4 + WI-1A.10 — SplitPaneEditor.
//
// Mounted by Editor.tsx (after WI-1A.5) for FormatConfig.kind === "split-pane"
// or "viewer". Composes:
//
//   ┌──────────────────────────┬──────────────────────────┐
//   │ SourcePane               │ Preview slot             │
//   │ (CodeMirror — WI-1A.9+)  │ (genericPreview or       │
//   │                          │  schemaRenderers)        │
//   │                          │                          │
//   └──────────────────────────┴──────────────────────────┘
//                              ▲
//                              │
//                          resize handle
//                          (keyboard ArrowLeft/Right)
//
// Skeleton today: validator slot is reserved on FormatConfig but the
// gutter rendering lives inside SourcePane in WI-1A.8. The split fraction
// is held in component state and clamped to [0.2, 0.8].

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { SourcePane } from "./SourcePane";
import type { FormatConfig } from "@/lib/formats/types";
import "./split-pane-editor.css";

export interface SplitPaneEditorProps {
  tabId: string;
  formatConfig: FormatConfig;
}

const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.8;
const STEP = 0.05;
const DEFAULT_FRACTION = 0.5;

function clamp(n: number): number {
  if (n < MIN_FRACTION) return MIN_FRACTION;
  if (n > MAX_FRACTION) return MAX_FRACTION;
  return n;
}

export function SplitPaneEditor({ tabId, formatConfig }: SplitPaneEditorProps) {
  const { t } = useTranslation("editor");
  const [fraction, setFraction] = useState(DEFAULT_FRACTION);
  const Preview = formatConfig.genericPreview;
  const hasPreview = Boolean(Preview);

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
      role="group"
      aria-label={t("splitPane.editorLabel", { format: formatConfig.id })}
      data-format-id={formatConfig.id}
      style={
        {
          "--split-pane-source-fraction": String(
            hasPreview ? fraction : 1,
          ),
        } as React.CSSProperties
      }
    >
      <div className="split-pane-editor__source">
        <SourcePane
          tabId={tabId}
          formatId={formatConfig.id}
          formatConfig={formatConfig}
        />
      </div>
      {hasPreview && (
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
      )}
      {hasPreview && Preview && (
        <div className="split-pane-editor__preview">
          <Preview content="" path={null} diagnostics={[]} />
        </div>
      )}
    </div>
  );
}

export default SplitPaneEditor;
