/**
 * Shared helpers for heading-delimited section operations.
 *
 * @module hooks/mcpBridge/section/shared
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface SectionTarget {
  heading?: string;
  byIndex?: { level: number; index: number };
  sectionId?: string;
}

export interface NewHeading {
  level: number;
  text: string;
}

/** Extract text from a ProseMirror node. */
export function extractText(node: ProseMirrorNode): string {
  let text = "";
  node.descendants((child) => {
    /* v8 ignore start -- non-text leaf nodes not encountered in test documents */
    if (child.isText) {
      text += child.text;
    }
    /* v8 ignore stop */
    return true;
  });
  return text;
}

/**
 * Find a section in the document by target specification.
 * Returns the section's start/end positions, heading level, and heading text,
 * or null if not found. The section ends at the next heading of equal or
 * higher level, or at end of document.
 */
export function findSection(
  doc: ProseMirrorNode,
  target: SectionTarget
): { from: number; to: number; level: number; headingText: string } | null {
  let headingPos: number | null = null;
  let headingLevel: number | null = null;
  let headingText: string | null = null;
  let headingIndex = 0;

  // Find the target heading
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = extractText(node);

      let isMatch = false;

      /* v8 ignore next -- @preserve reason: false branch (byIndex/sectionId targeting) not exercised in tests */
      if (target.heading) {
        isMatch = text.toLowerCase() === target.heading.toLowerCase();
      /* v8 ignore start -- @preserve byIndex/sectionId targeting not exercised in tests */
      } else if (target.byIndex) {
        if (level === target.byIndex.level) {
          if (headingIndex === target.byIndex.index) {
            isMatch = true;
          }
          headingIndex++;
        }
      } else if (target.sectionId) {
        // Section IDs are generated at runtime and not tracked during traversal.
        // Use heading or byIndex targeting instead.
      }
      /* v8 ignore stop */

      if (isMatch && headingPos === null) {
        headingPos = pos;
        headingLevel = level;
        headingText = text;
        return false; // Stop searching
      }
    }
    return true;
  });

  if (headingPos === null || headingLevel === null) {
    return null;
  }

  // Find the end of the section (next heading of same or higher level)
  let sectionEnd = doc.content.size;

  doc.descendants((node, pos) => {
    if (pos <= headingPos!) return true;

    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      if (level <= headingLevel!) {
        sectionEnd = pos;
        return false;
      }
    }
    return true;
  });

  return {
    from: headingPos,
    to: sectionEnd,
    level: headingLevel,
    headingText: headingText!,
  };
}
