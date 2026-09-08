/**
 * SplitDivider — draggable + keyboard-resizable separator between two
 * side-by-side document panes (#1081). The ARIA surface lives here; the
 * pointer-drag mechanics are `useSplitDrag` (touch and pen included; cleanup
 * on blur and unmount, the useSidebarResize discipline) and the keyboard
 * mapping is `keyboardResizeTarget` (audit 20260907, #277). The fraction is
 * clamped by paneStore.setFraction. Panes sit left | right, so the bar itself
 * is vertical and only Left/Right resize it.
 *
 * @coordinates-with ./useSplitDrag.ts — the drag half
 * @coordinates-with ./splitKeyboardResize.ts — the keyboard half
 * @module components/Editor/DocumentSplit/SplitDivider
 */
import { useTranslation } from "react-i18next";
import type { KeyboardEvent } from "react";
import { MIN_PANE_FRACTION, MAX_PANE_FRACTION } from "@/stores/paneStoreTypes";
import { useSplitDrag } from "./useSplitDrag";
import { keyboardResizeTarget } from "./splitKeyboardResize";

export interface SplitDividerProps {
  fraction: number;
  onResize: (fraction: number) => void;
}

export function SplitDivider({ fraction, onResize }: SplitDividerProps) {
  const { t } = useTranslation("editor");
  const { onPointerDown } = useSplitDrag(onResize);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = keyboardResizeTarget(e.key, fraction);
    if (target === null) return;
    e.preventDefault();
    onResize(target);
  };

  return (
    <div
      className="document-split__divider"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("split.dividerLabel")}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={Math.round(MIN_PANE_FRACTION * 100)}
      aria-valuemax={Math.round(MAX_PANE_FRACTION * 100)}
      onPointerDown={onPointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}
