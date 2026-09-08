/**
 * Viewport clamping for the workspace rail's context menu.
 *
 * Purpose: keep an anchored menu fully on screen, and KEEP it there. The
 * component recomputed the clamp only when the anchor point changed (audit R3
 * #654/#656), so a window resize under an open menu, or a menu that grew after
 * its translated labels laid out, left it hanging off the bottom or right edge
 * with no way to reach the items. Both inputs — the viewport and the menu's own
 * box — are now observed.
 *
 * The arithmetic is a pure function so the edge cases are pinned without a DOM:
 * a menu taller than the viewport clamps to the near margin rather than to a
 * negative coordinate, which would put it further off screen than the raw
 * pointer position did.
 *
 * @coordinates-with ./WorkspaceRailContextMenu.tsx — the only consumer
 * @module components/WorkspaceRail/workspaceRailMenuLayout
 */
import { useLayoutEffect, useState, type RefObject } from "react";

/** Keep the menu this far from the viewport edge when clamping. */
export const VIEWPORT_MARGIN = 8;

export interface MenuPoint {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

/**
 * Where an `size`-sized menu anchored at `at` should actually be drawn.
 *
 * `Math.max(MARGIN, …)` is applied LAST on purpose: when the menu does not fit
 * at all, `maxX`/`maxY` go negative and the min alone would place it off the
 * top-left. The near margin is the least-bad position, and it is the one from
 * which the user can still scroll or resize to reach the rest.
 */
export function clampToViewport(at: MenuPoint, size: Size, viewport: Size): MenuPoint {
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(at.x, viewport.width - size.width - VIEWPORT_MARGIN)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(at.y, viewport.height - size.height - VIEWPORT_MARGIN)),
  };
}

/**
 * The clamped position for the menu in `ref`, recomputed whenever the anchor,
 * the viewport or the menu's own size changes.
 *
 * `ResizeObserver` covers the size half: the menu's labels are translated and
 * a font or a locale change resizes it after the anchor was chosen. Where the
 * engine has none, the anchor and viewport halves still work — this is a
 * placement refinement, not a correctness gate.
 */
export function useMenuViewportClamp(
  at: MenuPoint,
  ref: RefObject<HTMLElement | null>,
): MenuPoint {
  const [clamped, setClamped] = useState(at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect();
      setClamped(
        clampToViewport(
          at,
          { width, height },
          { width: globalThis.innerWidth, height: globalThis.innerHeight },
        ),
      );
    };
    measure();

    globalThis.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      globalThis.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [at, ref]);

  return clamped;
}
