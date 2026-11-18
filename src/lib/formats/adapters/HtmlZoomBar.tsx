/**
 * Zoom controls for a standalone HTML preview (issue #1704).
 *
 * Purpose: render the zoom-out / zoom-in / reset cluster and the current
 * percentage. Owns nothing but the buttons — the zoom level itself lives in
 * HtmlPreview, so the same value that labels this bar also drives the frame's
 * `zoom`, and both read one set of limits from htmlZoom.ts.
 *
 * The percentage readout is a plain `<span>`, not a control: the three actions
 * are the buttons beside it, each labelled, and the number is just the current
 * state made visible.
 *
 * @coordinates-with htmlZoom.ts — the range and step
 * @module lib/formats/adapters/HtmlZoomBar
 */

import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_SM } from "@/utils/iconSizes";
import {
  HTML_ZOOM_DEFAULT_PERCENT,
  HTML_ZOOM_MAX_PERCENT,
  HTML_ZOOM_MIN_PERCENT,
} from "./htmlZoom";

export interface HtmlZoomBarProps {
  zoomPercent: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
}

export function HtmlZoomBar({ zoomPercent, onZoomOut, onZoomIn, onReset }: HtmlZoomBarProps) {
  const { t } = useTranslation("editor");
  const zoomOut = t("plugin.zoomOut");
  const zoomIn = t("plugin.zoomIn");
  const resetZoom = t("plugin.resetZoom");

  return (
    <div className="html-preview__zoom">
      <button
        type="button"
        className="vm-icon-btn vm-icon-btn--sm"
        aria-label={zoomOut}
        title={zoomOut}
        disabled={zoomPercent <= HTML_ZOOM_MIN_PERCENT}
        onClick={onZoomOut}
      >
        <ZoomOut size={ICON_SM} />
      </button>
      <span className="html-preview__zoom-value" data-testid="html-zoom-value">
        {zoomPercent}%
      </span>
      <button
        type="button"
        className="vm-icon-btn vm-icon-btn--sm"
        aria-label={zoomIn}
        title={zoomIn}
        disabled={zoomPercent >= HTML_ZOOM_MAX_PERCENT}
        onClick={onZoomIn}
      >
        <ZoomIn size={ICON_SM} />
      </button>
      <button
        type="button"
        className="vm-icon-btn vm-icon-btn--sm"
        aria-label={resetZoom}
        title={resetZoom}
        disabled={zoomPercent === HTML_ZOOM_DEFAULT_PERCENT}
        onClick={onReset}
      >
        <RotateCcw size={ICON_SM} />
      </button>
    </div>
  );
}
