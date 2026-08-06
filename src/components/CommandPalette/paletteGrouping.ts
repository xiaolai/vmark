/**
 * paletteGrouping — pure sectioning for the Command Palette (WI-4.2).
 *
 * Turns a flat ranked command list into the palette's VISUAL layout:
 *  - While SEARCHING (non-empty query) → one flat section, no header, so the
 *    best-scoring matches stay first regardless of category (VS Code model).
 *  - While BROWSING (empty query) → labelled sections grouped by category, so
 *    the ~150-command empty-search list stays navigable.
 *
 * The returned sections' items, flattened in order, ARE the palette's visual
 * order — `CommandPalette` indexes its selection into that flattened order, so
 * grouping never desyncs keyboard navigation from what's on screen.
 *
 * @module components/CommandPalette/paletteGrouping
 */

import type { RankedCommand } from "@/services/commands";

export interface PaletteSection {
  /** Category id, or `null` for the flat search-mode section. */
  id: string | null;
  /** Localized category label, or `null` when the section has no header. */
  label: string | null;
  items: RankedCommand[];
}

/**
 * Curated browse-mode section order — global/document surfaces first, then
 * editing categories, then tools. Categories absent here sort last,
 * alphabetically by localized label, so a newly-added category still renders
 * (never dropped) without a code change here.
 */
export const PALETTE_CATEGORY_ORDER: readonly string[] = [
  // Global / document surfaces
  "app",
  "file",
  "workspace",
  "view",
  "export",
  // Editing content
  "formatting",
  "headings",
  "lists",
  "blockquote",
  "inserts",
  "links",
  "tables",
  "lines",
  "selection",
  "transform",
  "cjk",
  "cleanup",
  "codeBlock",
  "edit",
  // Tools
  "lint",
  "image",
  "history",
  "format",
  "ai",
  "help",
];

/** Category id used for commands that declare no category. */
export const UNCATEGORIZED = "other";

/**
 * Partition ranked commands into the palette's visual sections.
 *
 * @param labelFor resolves a category id to its localized label (the caller
 *   wires this through i18n with a raw-id `defaultValue`, so an unlabeled
 *   category degrades to its id rather than vanishing).
 * @param locale BCP-47 tag for the alphabetical tie-break among categories
 *   absent from the curated order — passed so accented/locale-specific
 *   collation follows VMark's selected language, not the host's default.
 */
export function buildPaletteSections(
  ranked: readonly RankedCommand[],
  query: string,
  labelFor: (categoryId: string) => string,
  locale?: string,
): PaletteSection[] {
  if (query.trim() !== "") {
    return [{ id: null, label: null, items: [...ranked] }];
  }

  const byCategory = new Map<string, RankedCommand[]>();
  for (const entry of ranked) {
    const category = entry.command.category ?? UNCATEGORIZED;
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(entry);
    else byCategory.set(category, [entry]);
  }

  const orderOf = (category: string): number => {
    const index = PALETTE_CATEGORY_ORDER.indexOf(category);
    return index === -1 ? PALETTE_CATEGORY_ORDER.length : index;
  };

  return [...byCategory.keys()]
    .sort((a, b) => {
      const byOrder = orderOf(a) - orderOf(b);
      if (byOrder !== 0) return byOrder;
      return labelFor(a).localeCompare(labelFor(b), locale);
    })
    .map((category) => ({
      id: category,
      label: labelFor(category),
      items: byCategory.get(category)!,
    }));
}
