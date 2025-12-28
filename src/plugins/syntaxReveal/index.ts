/**
 * Syntax Reveal Plugin - Decoration-based Approach
 *
 * Shows markdown syntax markers (**, *, `, ~~, []) when cursor
 * is inside a formatted mark. Uses ProseMirror decorations to
 * display syntax without modifying document structure.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node, Mark, ResolvedPos } from "@milkdown/kit/prose/model";

// Plugin key for external access
export const syntaxRevealPluginKey = new PluginKey("syntaxReveal");

// Mark type to syntax mapping
const MARK_SYNTAX: Record<string, { open: string; close: string }> = {
  strong: { open: "**", close: "**" },
  emphasis: { open: "*", close: "*" },
  inlineCode: { open: "`", close: "`" },
  strikethrough: { open: "~~", close: "~~" },
};

// Link mark needs special handling
const LINK_MARK = "link";

interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/**
 * Find all mark ranges that contain the given position
 */
function findMarksAtPosition(
  pos: number,
  $pos: ResolvedPos
): MarkRange[] {
  const ranges: MarkRange[] = [];

  // Get the parent node and iterate through its content
  const parent = $pos.parent;
  const parentStart = $pos.start();

  parent.forEach((child, childOffset) => {
    const from = parentStart + childOffset;
    const to = from + child.nodeSize;

    // Check if position is within this child's range
    if (pos >= from && pos <= to && child.isText) {
      child.marks.forEach((mark) => {
        // Find the full extent of this mark
        const markRange = findMarkRange(pos, mark, parentStart, parent);
        if (markRange) {
          // Avoid duplicates
          if (!ranges.some((r) => r.from === markRange.from && r.to === markRange.to)) {
            ranges.push(markRange);
          }
        }
      });
    }
  });

  return ranges;
}

/**
 * Find the full range of a mark starting from a position
 * Uses single-pass algorithm to find contiguous mark boundaries
 */
function findMarkRange(
  pos: number,
  mark: Mark,
  parentStart: number,
  parent: Node
): MarkRange | null {
  let from = -1;
  let to = -1;

  // Single pass to find contiguous mark range containing pos
  parent.forEach((child, childOffset) => {
    const childFrom = parentStart + childOffset;
    const childTo = childFrom + child.nodeSize;

    if (child.isText && mark.isInSet(child.marks)) {
      // Extend or start the range
      if (from === -1) {
        from = childFrom;
      }
      to = childTo;
    } else if (from !== -1 && to !== -1) {
      // Mark ended - check if pos was in this range
      if (pos >= from && pos <= to) {
        return; // Found it, stop processing
      }
      // Reset for potential next occurrence
      from = -1;
      to = -1;
    }
  });

  // Check final range
  if (from !== -1 && to !== -1 && pos >= from && pos <= to) {
    return { mark, from, to };
  }

  return null;
}

/**
 * Create the syntax reveal plugin
 */
export const syntaxRevealPlugin = $prose(() => {
  return new Plugin({
    key: syntaxRevealPluginKey,

    props: {
      decorations(state) {
        const { selection } = state;
        const { $from, empty } = selection;

        // Only show syntax for cursor (not selection)
        if (!empty) {
          return DecorationSet.empty;
        }

        const pos = $from.pos;
        const markRanges = findMarksAtPosition(pos, $from);

        if (markRanges.length === 0) {
          return DecorationSet.empty;
        }

        // We need to create decorations here since we have access to document
        const decorations: Decoration[] = [];

        for (const { mark, from, to } of markRanges) {
          const syntax = MARK_SYNTAX[mark.type.name];

          if (syntax) {
            decorations.push(
              Decoration.widget(from, createSyntaxWidget(syntax.open, "open"), { side: -1 })
            );
            decorations.push(
              Decoration.widget(to, createSyntaxWidget(syntax.close, "close"), { side: 1 })
            );
          } else if (mark.type.name === LINK_MARK) {
            const href = mark.attrs.href || "";
            decorations.push(
              Decoration.widget(from, createSyntaxWidget("[", "link-open"), { side: -1 })
            );
            decorations.push(
              Decoration.widget(to, createSyntaxWidget(`](${href})`, "link-close"), { side: 1 })
            );
          }
        }

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
});

/**
 * Create a syntax widget element
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

export default syntaxRevealPlugin;
