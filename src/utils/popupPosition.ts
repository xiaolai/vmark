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
 * - Horizontally centers on anchor, constrained to horizontal bounds
 * - Vertically prefers above/below based on preference, with space detection
 * - Falls back to whichever direction has more space
 */
export function calculatePopupPosition(options: PositionOptions): PopupPosition {
  const { anchor, popup, bounds, gap = 6, preferAbove = true } = options;

  // Horizontal: center on anchor, constrain to horizontal bounds
  const anchorCenterX = (anchor.left + anchor.right) / 2;
  let left = anchorCenterX - popup.width / 2;
  left = Math.max(bounds.horizontal.left + gap, left);
  left = Math.min(bounds.horizontal.right - popup.width - gap, left);

  // Vertical: prefer above/below based on preference, with space detection
  const spaceAbove = anchor.top - bounds.vertical.top;
  const spaceBelow = bounds.vertical.bottom - anchor.bottom;
  const needsHeight = popup.height + gap;

  let top: number;
  const primaryHasSpace = preferAbove
    ? spaceAbove >= needsHeight
    : spaceBelow >= needsHeight;
  const secondaryHasSpace = preferAbove
    ? spaceBelow >= needsHeight
    : spaceAbove >= needsHeight;

  if (primaryHasSpace) {
    top = preferAbove
      ? anchor.top - popup.height - gap
      : anchor.bottom + gap;
  } else if (secondaryHasSpace) {
    top = preferAbove
      ? anchor.bottom + gap
      : anchor.top - popup.height - gap;
  } else {
    // Neither has enough space - use whichever has more
    top = spaceAbove > spaceBelow
      ? anchor.top - popup.height - gap
      : anchor.bottom + gap;
  }

  // Final clamp to vertical bounds
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
