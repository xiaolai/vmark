/**
 * useMenuPosition
 *
 * Purpose: place a fixed-position popup menu at viewport coordinates and keep it
 * on screen — when the menu would spill past the right/bottom edge it is nudged
 * back inside, never closer than VIEWPORT_MARGIN to any edge.
 *
 * Key decisions:
 *   - Positioning is imperative (writes style.left/top on the element) rather
 *     than state-driven: the correction needs the menu's measured size, so a
 *     state round-trip would paint the unclamped position first.
 *   - Re-applies on window resize/scroll and on visualViewport resize/scroll, so
 *     the menu follows the viewport instead of drifting off it.
 *
 * @coordinates-with TabContextMenu.tsx — the tab right-click menu
 * @module components/Tabs/useMenuPosition
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Viewport coordinates for context menu placement. */
export interface ContextMenuPosition {
  x: number;
  y: number;
}

/** Smallest gap kept between the menu and any viewport edge. */
const VIEWPORT_MARGIN = 10;

/** Keep `menuRef`'s element pinned at `position`, clamped into the viewport. */
export function useMenuPosition(
  menuRef: RefObject<HTMLElement | null>,
  position: ContextMenuPosition,
): void {
  const positionRef = useRef(position);

  const applyMenuPosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = positionRef.current.x;
    let adjustedY = positionRef.current.y;

    if (adjustedX + rect.width > viewportWidth - VIEWPORT_MARGIN) {
      adjustedX = Math.max(VIEWPORT_MARGIN, viewportWidth - rect.width - VIEWPORT_MARGIN);
    }
    if (adjustedY + rect.height > viewportHeight - VIEWPORT_MARGIN) {
      adjustedY = Math.max(VIEWPORT_MARGIN, viewportHeight - rect.height - VIEWPORT_MARGIN);
    }

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [menuRef]);

  useEffect(() => {
    positionRef.current = position;
    applyMenuPosition();
  }, [applyMenuPosition, position]);

  useEffect(() => {
    const handleViewportChange = () => applyMenuPosition();
    const visualViewport = window.visualViewport;

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    visualViewport?.addEventListener("resize", handleViewportChange);
    visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      visualViewport?.removeEventListener("resize", handleViewportChange);
      visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, [applyMenuPosition]);
}
