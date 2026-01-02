/**
 * Popup Positioning Utility
 *
 * Reusable positioning logic for floating popups.
 * Supports separate horizontal/vertical boundary constraints,
 * space detection, and configurable placement preference.
 */

export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface BoundaryRects {
  horizontal: { left: number; right: number };
  vertical: { top: number; bottom: number };
}

export interface PopupDimensions {
  width: number;
  height: number;
}

export interface PositionOptions {
  anchor: AnchorRect;
  popup: PopupDimensions;
  bounds: BoundaryRects;
  gap?: number;
  preferAbove?: boolean;
}

export interface PopupPosition {
  top: number;
  left: number;
}

/**
 * Calculate popup position relative to an anchor element.
 *
 * Positioning priority:
 * 1. Above anchor (no overlap) - preferred
 * 2. Below anchor (no overlap) - fallback
 * 3. Overlap at visible anchor area - for large anchors exceeding viewport
 */
export function calculatePopupPosition(options: PositionOptions): PopupPosition {
  const { anchor, popup, bounds, gap = 6, preferAbove = true } = options;

  // Horizontal: center on anchor, constrain to horizontal bounds
  const anchorCenterX = (anchor.left + anchor.right) / 2;
  let left = anchorCenterX - popup.width / 2;
  left = Math.max(bounds.horizontal.left + gap, left);
  left = Math.min(bounds.horizontal.right - popup.width - gap, left);

  // Vertical: improved algorithm with overlap mode for large anchors
  const spaceAbove = anchor.top - bounds.vertical.top;
  const spaceBelow = bounds.vertical.bottom - anchor.bottom;
  const neededHeight = popup.height + gap;

  let top: number;

  if (preferAbove && spaceAbove >= neededHeight) {
    // Case 1: Enough space above - position above (no overlap)
    top = anchor.top - popup.height - gap;
  } else if (spaceBelow >= neededHeight) {
    // Case 2: Enough space below - position below (no overlap)
    top = anchor.bottom + gap;
  } else if (!preferAbove && spaceAbove >= neededHeight) {
    // Case 2b: Prefer below didn't work, but above works
    top = anchor.top - popup.height - gap;
  } else {
    // Case 3: Large anchor (e.g., table) - overlap mode
    // Position at top of visible anchor area
    const visibleTop = Math.max(anchor.top, bounds.vertical.top);
    top = visibleTop + gap;
  }

  // Final clamp to ensure popup stays in bounds
  top = Math.max(bounds.vertical.top + gap, top);
  top = Math.min(bounds.vertical.bottom - popup.height - gap, top);

  return { top, left };
}

/**
 * Get boundary rects from DOM elements.
 *
 * @param horizontalEl - Element for left/right constraints
 * @param verticalEl - Element for top/bottom constraints
 */
export function getBoundaryRects(
  horizontalEl: HTMLElement,
  verticalEl: HTMLElement
): BoundaryRects {
  const hRect = horizontalEl.getBoundingClientRect();
  const vRect = verticalEl.getBoundingClientRect();
  return {
    horizontal: { left: hRect.left, right: hRect.right },
    vertical: { top: vRect.top, bottom: vRect.bottom },
  };
}

/**
 * Get viewport bounds as fallback.
 */
export function getViewportBounds(): BoundaryRects {
  return {
    horizontal: { left: 0, right: window.innerWidth },
    vertical: { top: 0, bottom: window.innerHeight },
  };
}
