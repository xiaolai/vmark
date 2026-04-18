/**
 * Bare list-marker normalization and follow-up spread cleanup.
 *
 * Users commonly type `  -\n` expecting an empty nested list item, but
 * CommonMark requires a trailing space after the marker. The pre-parser
 * normalizes these lines and the post-parser unpicks the `spread: true`
 * artifacts that the blank-line insertion introduces.
 *
 * @module utils/markdownPipeline/parser/listNormalization
 */

import type { Root, Parent, List, ListItem, Paragraph, Text } from "mdast";

/**
 * Normalize bare list markers that lack a trailing space.
 *
 * CommonMark requires `- ` (dash + space) for a list item. A bare `  -` at end
 * of line is NOT a valid list marker — it becomes paragraph text. Users commonly
 * type `  -` expecting an empty nested list item, so we add the trailing space.
 *
 * Only matches indented markers (1–4 spaces) to avoid touching top-level text.
 * Skips fenced code blocks to avoid corrupting code content.
 */
export function normalizeBareListMarkers(markdown: string): { text: string; modified: boolean } {
  const lines = markdown.split("\n");
  let inFencedBlock = false;
  let fenceChar = "";
  let fenceLen = 0;
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/\r$/, "");

    // Track fenced code blocks
    if (!inFencedBlock) {
      const openMatch = trimmed.match(/^ {0,3}(`{3,}|~{3,})/);
      if (openMatch) {
        inFencedBlock = true;
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        continue;
      }
    } else {
      const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}\\s*$`);
      if (closeRe.test(trimmed)) {
        inFencedBlock = false;
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }

    // Match: bare indented list markers (no content after marker, or only whitespace).
    // In CommonMark, an empty list item cannot interrupt a paragraph.
    // Insert a blank line before it so the paragraph ends first,
    // and ensure a trailing space so the marker is valid.
    // Only match markers that need fixing: no trailing space, or missing blank line.
    if (/^ {1,4}[-+*][ \t]*$/.test(trimmed)) {
      let changed = false;
      // Add blank line before if previous line is non-blank (paragraph interruption fix)
      if (i > 0 && lines[i - 1].trim() !== "") {
        lines.splice(i, 0, "");
        i++; // skip the blank line we just inserted
        changed = true;
      }
      // Ensure at least one space after the marker
      const fixed = trimmed.replace(/^( {1,4}[-+*])[ \t]*$/, "$1 ");
      if (fixed !== lines[i]) {
        lines[i] = fixed;
        changed = true;
      }
      if (changed) modified = true;
    }
  }

  return { text: lines.join("\n"), modified };
}

/**
 * Fix spread artifacts from normalizeBareListMarkers.
 *
 * The normalizer inserts blank lines before bare markers so CommonMark parses
 * them correctly, but this makes the containing listItem "loose" (spread: true).
 * remark-stringify then emits blank lines between the item's children on
 * round-trip, which the user didn't write. Reset spread on listItems that
 * became loose solely because they contain a nested list with empty items.
 */
export function fixNormalizationSpread(node: Root | Parent): void {
  /* v8 ignore next -- @preserve defensive guard: always called with Root or Parent nodes; protects against unexpected leaf nodes in recursive calls */
  if (!("children" in node) || !Array.isArray(node.children)) return;

  for (const child of node.children) {
    if ("children" in child && Array.isArray((child as Parent).children)) {
      fixNormalizationSpread(child as Parent);
    }

    // Fix listItem spread when it contains a nested list with empty items
    if (child.type === "listItem") {
      const li = child as ListItem;
      if (li.spread && hasNestedEmptyListItem(li)) {
        li.spread = false;
      }
    }

    // Fix list spread: if no children are spread, the list shouldn't be either
    if (child.type === "list") {
      const list = child as List;
      if (list.spread) {
        const anyChildSpread = list.children.some((item) => item.spread);
        if (!anyChildSpread) {
          list.spread = false;
        }
      }
    }
  }
}

function hasNestedEmptyListItem(li: ListItem): boolean {
  for (const child of li.children) {
    if (child.type === "list") {
      const list = child as List;
      for (const item of list.children) {
        if (isEmptyListItem(item)) return true;
      }
    }
  }
  return false;
}

function isEmptyListItem(li: ListItem): boolean {
  if (li.children.length === 0) return true;
  if (li.children.length === 1 && li.children[0].type === "paragraph") {
    const para = li.children[0] as Paragraph;
    return (
      para.children.length === 0 ||
      (para.children.length === 1 &&
        para.children[0].type === "text" &&
        !(para.children[0] as Text).value.trim())
    );
  }
  return false;
}
