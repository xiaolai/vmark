/**
 * SplitDivider — draggable + keyboard-resizable separator between two document
 * panes (#1081). Combines the SplitPaneEditor keyboard a11y (role=separator,
 * arrow/Home/End) with mouse-drag mechanics (useSidebarResize pattern). The
 * fraction is clamped by paneStore.setFraction.
 *
 * @module components/Editor/DocumentSplit/SplitDivider
 */
import { useTranslation } from "react-i18next";
import type { KeyboardEvent, MouseEvent } from "react";
import type { SplitOrientation } from "@/stores/paneStore";

const KEYBOARD_STEP = 0.05;

export interface SplitDividerProps {
  orientation: SplitOrientation;
  fraction: number;
  onResize: (fraction: number) => void;
}

export function SplitDivider({ orientation, fraction, onResize }: SplitDividerProps) {
  const { t } = useTranslation("editor");
  const horizontal = orientation === "horizontal"; // panes left|right ⇒ vertical bar

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: globalThis.MouseEvent) => {
      const pos = horizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      onResize(pos);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
    const increase = horizontal ? "ArrowRight" : "ArrowDown";
    if (e.key === decrease) {
      e.preventDefault();
      onResize(fraction - KEYBOARD_STEP);
    } else if (e.key === increase) {
      e.preventDefault();
      onResize(fraction + KEYBOARD_STEP);
    } else if (e.key === "Home") {
      e.preventDefault();
      onResize(0.2);
    } else if (e.key === "End") {
      e.preventDefault();
      onResize(0.8);
    }
  };

  return (
    <div
      className="document-split__divider"
      role="separator"
      tabIndex={0}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={t("split.dividerLabel")}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={20}
      aria-valuemax={80}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
    />
  );
}
