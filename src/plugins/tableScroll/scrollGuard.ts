/**
 * Table Scroll Guard
 *
 * Purpose: Prevents ProseMirror's scrollRectIntoView from causing unwanted
 * horizontal scroll jumps on .table-scroll-wrapper elements when the cursor
 * moves inside a table cell.
 *
 * Key decisions:
 *   - Uses handleScrollToSelection (ProseMirror's official escape hatch) rather
 *     than a standalone plugin or CSS hacks.
 *   - Returns true (suppress PM default) only when cursor is inside a table,
 *     performing vertical-only scroll manually.
 *   - Returns false for non-table positions, letting PM handle scroll normally.
 *   - Falls back to PM default when coordsAtPos throws (detached/invalid
 *     positions). Unsupported scrollMargin shapes use a safe default margin.
 *
 * @coordinates-with TiptapEditor.tsx — called from editorProps.handleScrollToSelection
 * @coordinates-with index.ts — table scroll wrapper NodeView
 * @module plugins/tableScroll/scrollGuard
 */

import type { EditorView } from "@tiptap/pm/view";

/** Default scroll margin in pixels when none is configured. */
const DEFAULT_SCROLL_MARGIN = 5;

/**
 * Extract vertical scroll margins from PM's scrollMargin prop.
 * PM allows `number` (uniform) or `{top, bottom, left, right}` (per-side).
 * Returns `{top, bottom}` in pixels, falling back to DEFAULT_SCROLL_MARGIN.
 */
function resolveVerticalMargin(raw: unknown): { top: number; bottom: number } {
  if (typeof raw === "number") {
    return { top: raw, bottom: raw };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      top: typeof obj.top === "number" ? obj.top : DEFAULT_SCROLL_MARGIN,
      bottom: typeof obj.bottom === "number" ? obj.bottom : DEFAULT_SCROLL_MARGIN,
    };
  }
  return { top: DEFAULT_SCROLL_MARGIN, bottom: DEFAULT_SCROLL_MARGIN };
}

/**
 * Check if the current selection head is inside a table node.
 */
function isSelectionInTable(view: EditorView): boolean {
  const { $head } = view.state.selection;
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type.name === "table") return true;
  }
  return false;
}

/**
 * Performs vertical-only scroll on .editor-content when cursor is in a table.
 * Suppresses ProseMirror's default scrollRectIntoView to prevent horizontal
 * scroll jumps on .table-scroll-wrapper.
 *
 * For non-table selections, returns false to use PM's default scroll behavior.
 *
 * @returns true if scroll was handled (suppress PM default), false otherwise
 */
export function handleTableScrollToSelection(view: EditorView): boolean {
  if (!isSelectionInTable(view)) return false;

  const scrollContainer = view.dom.closest(".editor-content") as HTMLElement | null;
  if (!scrollContainer) return false;

  try {
    const coords = view.coordsAtPos(view.state.selection.head, 1);
    const rect = scrollContainer.getBoundingClientRect();
    const margin = resolveVerticalMargin(view.someProp("scrollMargin"));

    if (coords.top < rect.top + margin.top) {
      scrollContainer.scrollTop -= rect.top + margin.top - coords.top;
    } else if (coords.bottom > rect.bottom - margin.bottom) {
      scrollContainer.scrollTop += coords.bottom - rect.bottom + margin.bottom;
    }
  } catch {
    // coordsAtPos can throw for detached/invalid positions — fall back to PM default
    return false;
  }

  return true;
}
