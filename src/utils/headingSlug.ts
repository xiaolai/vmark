/**
 * Heading Slug Utilities
 *
 * Generates stable, unique IDs for document headings.
 * Used for bookmark/anchor links and fragment navigation.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { linkPopupError } from "@/utils/debug";

/**
 * Minimal structural shape required for fragment navigation. Compatible with
 * both `@tiptap/pm/view`'s `EditorView` and the popup-shared `EditorViewLike`.
 */
type NavigableEditorView = {
  state: EditorState & { tr: Transaction };
  dispatch: (tr: Transaction) => void;
  focus: () => void;
};

/**
 * Generate a URL-safe slug from heading text.
 * Follows GitHub-style slug generation.
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "") // Keep alphanumeric, spaces, CJK, hyphens
    .replace(/\s+/g, "-") // Spaces to hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Make a slug unique by appending a counter if needed.
 */
export function makeUniqueSlug(slug: string, existing: Set<string>): string {
  if (!slug) return "";
  if (!existing.has(slug)) return slug;

  let counter = 1;
  while (existing.has(`${slug}-${counter}`)) {
    counter++;
  }
  return `${slug}-${counter}`;
}

/**
 * Heading with generated ID and document position.
 */
export interface HeadingWithId {
  level: number;
  text: string;
  id: string;
  pos: number;
}

/**
 * Extract all headings from a ProseMirror document with generated IDs.
 * IDs are made unique within the document.
 */
export function extractHeadingsWithIds(doc: PMNode): HeadingWithId[] {
  const headings: HeadingWithId[] = [];
  const usedSlugs = new Set<string>();

  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = node.textContent;
      const level = node.attrs.level as number;
      const baseSlug = generateSlug(text);
      const id = makeUniqueSlug(baseSlug, usedSlugs);

      if (id) {
        usedSlugs.add(id);
        headings.push({ level, text, id, pos });
      }
    }
    return true; // Continue traversal
  });

  return headings;
}

/**
 * Find a heading by its ID in a ProseMirror document.
 * Returns the position or null if not found.
 */
export function findHeadingById(doc: PMNode, targetId: string): number | null {
  const headings = extractHeadingsWithIds(doc);
  const found = headings.find((h) => h.id === targetId);
  return found?.pos ?? null;
}

/**
 * Navigate the given ProseMirror view to the heading whose generated ID
 * matches `targetId`. Sets a non-history selection at the heading and
 * scrolls it into view. Returns true if the heading was found and the
 * transaction dispatched; false otherwise.
 *
 * Shared between Cmd+Click (linkPopup tiptap plugin) and the link popup's
 * Open icon — both used to maintain near-identical inline copies.
 */
export function navigateToHeadingById(view: NavigableEditorView, targetId: string): boolean {
  const pos = findHeadingById(view.state.doc, targetId);
  if (pos === null) return false;

  try {
    const $pos = view.state.doc.resolve(pos + 1);
    const selection = TextSelection.near($pos);
    const tr = view.state.tr.setSelection(selection).scrollIntoView();
    view.dispatch(tr.setMeta("addToHistory", false));
    view.focus();
    return true;
  } catch (error) {
    linkPopupError("Fragment navigation error:", error);
    return false;
  }
}

/**
 * Find a heading by its ID in a CodeMirror document.
 * Returns the line start position or null if not found.
 */
export function findHeadingByIdCM(
  doc: { lines: number; line: (n: number) => { from: number; text: string } },
  targetId: string
): number | null {
  const usedSlugs = new Set<string>();

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    // Check if line starts with # (heading)
    const headingMatch = text.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const headingText = headingMatch[2];
      const baseSlug = generateSlug(headingText);
      const id = makeUniqueSlug(baseSlug, usedSlugs);

      if (id) {
        usedSlugs.add(id);
        if (id === targetId) {
          return line.from;
        }
      }
    }
  }

  return null;
}
