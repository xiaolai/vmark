/**
 * Sidebar Resize Handle
 *
 * Purpose: Focusable ARIA separator that drives sidebar resizing via
 *   mouse drag and arrow-key steps. Owns the JSX wiring so it can be
 *   exercised without booting the whole App tree.
 *
 * @coordinates-with useSidebarResize.ts — supplies the handlers
 * @coordinates-with App.tsx — consumer; passes the live sidebar width
 * @module components/Sidebar/SidebarResizeHandle
 */

import { useTranslation } from "react-i18next";
import {
  useSidebarResize,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from "@/hooks/useSidebarResize";

interface SidebarResizeHandleProps {
  /** Live sidebar width — drives aria-valuenow so screen readers
   *  announce the current width after each adjustment. */
  width: number;
}

/**
 * WI-2.2 (a11y): focusable separator with arrow-key resize.
 * role=separator + aria-orientation=vertical announces purpose;
 * tabIndex=0 puts it in tab order; aria-valuenow/min/max + the
 * live `width` prop let screen readers report current width.
 */
export function SidebarResizeHandle({ width }: SidebarResizeHandleProps) {
  const { t } = useTranslation();
  const { handleResizeStart, handleResizeKeyDown } = useSidebarResize();

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("aria.sidebarResize")}
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabIndex={0}
      onMouseDown={handleResizeStart}
      onKeyDown={handleResizeKeyDown}
    />
  );
}
