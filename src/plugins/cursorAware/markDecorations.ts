/**
 * Cursor-Aware Mark Decorations
 *
 * Adds widget decorations to show syntax markers when cursor is inside marks.
 * Uses widget decorations (inserting new DOM elements) instead of inline
 * decorations to avoid infinite loop issues with React/Milkdown.
 */

import type { Decoration } from "@milkdown/kit/prose/view";
import { Decoration as Dec } from "@milkdown/kit/prose/view";
import type { Node, Mark, ResolvedPos } from "@milkdown/kit/prose/model";

// Mark type to syntax mapping
const MARK_SYNTAX: Record<string, { open: string; close: string }> = {
  strong: { open: "**", close: "**" },
  emphasis: { open: "*", close: "*" },
  inlineCode: { open: "`", close: "`" },
  strikethrough: { open: "~~", close: "~~" },
  subscript: { open: "~", close: "~" },
  superscript: { open: "^", close: "^" },
  highlight: { open: "==", close: "==" },
};

const LINK_MARK = "link";

// Mark types that support cursor-aware editing
const CURSOR_AWARE_MARKS = new Set([
  ...Object.keys(MARK_SYNTAX),
  LINK_MARK,
]);

export interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/**
 * Create a syntax widget element.
 */
function createSyntaxWidget(text: string, type: string) {
  return () => {
    const span = document.createElement("span");
    span.className = `syntax-marker syntax-marker-${type}`;
    span.textContent = text;
    span.contentEditable = "false";
    return span;
  };
}

/**
 * Find the contiguous range of a mark containing the cursor position.
 */
function findMarkRange(
  pos: number,
  mark: Mark,
  parentStart: number,
  parent: Node
): MarkRange | null {
  let currentFrom = -1;
  let currentTo = -1;
  let foundRange: MarkRange | null = null;

  parent.forEach((child, childOffset) => {
    if (foundRange) return;

    const childFrom = parentStart + childOffset;
    const childTo = childFrom + child.nodeSize;

    if (child.isText && mark.isInSet(child.marks)) {
      if (currentFrom === -1) {
        currentFrom = childFrom;
      }
      currentTo = childTo;
    } else {
      if (currentFrom !== -1 && currentTo !== -1) {
        if (pos >= currentFrom && pos <= currentTo) {
          foundRange = { mark, from: currentFrom, to: currentTo };
        }
      }
      currentFrom = -1;
      currentTo = -1;
    }
  });

  // Check final accumulated range
  if (!foundRange && currentFrom !== -1 && currentTo !== -1) {
    if (pos >= currentFrom && pos <= currentTo) {
      foundRange = { mark, from: currentFrom, to: currentTo };
    }
  }

  return foundRange;
}

/**
 * Find all mark ranges that contain the cursor position.
 */
function findMarksAtPosition(pos: number, $pos: ResolvedPos): MarkRange[] {
  const ranges: MarkRange[] = [];
  const parent = $pos.parent;
  const parentStart = $pos.start();

  parent.forEach((child, childOffset) => {
    const from = parentStart + childOffset;
    const to = from + child.nodeSize;

    if (pos >= from && pos <= to && child.isText) {
      child.marks.forEach((mark) => {
        if (!CURSOR_AWARE_MARKS.has(mark.type.name)) return;

        const markRange = findMarkRange(pos, mark, parentStart, parent);
        if (markRange) {
          // Avoid duplicates
          if (!ranges.some((r) => r.from === markRange.from && r.to === markRange.to && r.mark.type.name === mark.type.name)) {
            ranges.push(markRange);
          }
        }
      });
    }
  });

  return ranges;
}

/**
 * Find mark ranges that are adjacent to cursor (ending at or starting at cursor).
 * Used for upgrades when cursor is OUTSIDE the mark: `*italic*|` or `|*italic*`
 */
function findAdjacentMarks(pos: number, $pos: ResolvedPos): MarkRange[] {
  const ranges: MarkRange[] = [];
  const parent = $pos.parent;
  const parentStart = $pos.start();

  // Track all mark ranges in this parent
  const allMarkRanges: MarkRange[] = [];

  parent.forEach((child, childOffset) => {
    if (!child.isText) return;

    const from = parentStart + childOffset;

    child.marks.forEach((mark) => {
      if (!CURSOR_AWARE_MARKS.has(mark.type.name)) return;

      // Find the full contiguous range for this mark
      const markRange = findMarkRange(from, mark, parentStart, parent);
      if (markRange) {
        // Avoid duplicates
        if (!allMarkRanges.some((r) =>
          r.from === markRange.from &&
          r.to === markRange.to &&
          r.mark.type.name === mark.type.name
        )) {
          allMarkRanges.push(markRange);
        }
      }
    });
  });

  // Filter to marks that end at or start at cursor position
  for (const markRange of allMarkRanges) {
    if (markRange.to === pos || markRange.from === pos) {
      if (!ranges.some((r) =>
        r.from === markRange.from &&
        r.to === markRange.to &&
        r.mark.type.name === markRange.mark.type.name
      )) {
        ranges.push(markRange);
      }
    }
  }

  return ranges;
}

/**
 * Add widget decoration for syntax marker.
 */
function addWidgetDecoration(
  decorations: Decoration[],
  pos: number,
  text: string,
  type: string,
  side: -1 | 1 = -1
): void {
  decorations.push(
    Dec.widget(pos, createSyntaxWidget(text, type), { side })
  );
}

/**
 * Add mark widget decorations for cursor-aware editing.
 * Uses widget decorations to insert syntax markers.
 */
export function addMarkWidgetDecorations(
  decorations: Decoration[],
  pos: number,
  $from: ResolvedPos
): void {
  const markRanges = findMarksAtPosition(pos, $from);

  for (const { mark, from, to } of markRanges) {
    const markName = mark.type.name;
    const syntax = MARK_SYNTAX[markName];

    if (syntax) {
      addWidgetDecoration(decorations, from, syntax.open, "open", -1);
      addWidgetDecoration(decorations, to, syntax.close, "close", 1);
    } else if (markName === LINK_MARK) {
      const href = mark.attrs.href || "";
      addWidgetDecoration(decorations, from, "[", "link-open", -1);
      addWidgetDecoration(decorations, to, `](${href})`, "link-close", 1);
    }
  }
}

// Keep the old function name for backwards compatibility during migration
export const addMarkDecorations = addMarkWidgetDecorations;

// Export for key handlers
export { findMarksAtPosition, findAdjacentMarks, MARK_SYNTAX };
