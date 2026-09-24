/**
 * Link mark range lookup.
 *
 * Purpose: find the contiguous span covered by the link mark at a document
 * position, so a click and the edit popup agree on which link they act on. A
 * marked inline image is part of the span, not a gap in it — a link can wrap
 * one (`[text ![a](p.png) more](A.md)`), and editing only the text before it
 * would split the link (#1448).
 *
 * @coordinates-with tiptap.ts — the click handlers that consume it
 * @module plugins/linkPopup/findLinkMarkRange
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Mark } from "@tiptap/pm/model";

export interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/** Finds the range of a link mark at the given document position, or null. */
export function findLinkMarkRange(view: EditorView, pos: number): MarkRange | null {
  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  // First pass: find the link mark at the given position
  let linkMark: Mark | null = null;
  let currentOffset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = parentStart + currentOffset;
    const childTo = childFrom + child.nodeSize;

    if (pos >= childFrom && pos < childTo && child.isInline) {
      const mark = child.marks.find((m) => m.type.name === "link");
      if (mark) {
        linkMark = mark;
        break;
      }
    }
    currentOffset += child.nodeSize;
  }

  if (!linkMark) return null;

  // Second pass: find the continuous range covered by an *equal* link mark that
  // contains pos. Mark.eq compares attrs, not just href — two adjacent links
  // that share an href but differ in any other attribute stay separate ranges,
  // so editing one can no longer rewrite its neighbour.
  const target = linkMark;
  currentOffset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = parentStart + currentOffset;

    if (child.isInline) {
      const mark = child.marks.find((m) => m.eq(target));

      if (mark) {
        const rangeFrom = childFrom;
        let rangeTo = childFrom + child.nodeSize;
        const foundMark = mark;

        // Continue checking subsequent children for continuous equal marks
        let j = i + 1;
        while (j < parent.childCount) {
          const nextChild = parent.child(j);
          if (nextChild.isInline) {
            const nextMark = nextChild.marks.find((m) => m.eq(target));
            if (nextMark) {
              rangeTo += nextChild.nodeSize;
              j++;
            } else {
              break;
            }
          } else {
            break;
          }
        }

        if (pos >= rangeFrom && pos < rangeTo) {
          return { mark: foundMark, from: rangeFrom, to: rangeTo };
        }

        currentOffset = rangeTo - parentStart;
        i = j - 1;
        continue;
      }
    }
    currentOffset += child.nodeSize;
  }

  return null;
}
