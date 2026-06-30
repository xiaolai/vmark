/**
 * Menu-ID contract extraction (Rust ↔ TS).
 *
 * Purpose: Single source of truth for extracting `MenuItem::with_id` IDs from
 *   the Rust menu modules and for the curated exclusion list separating
 *   action-registry-routed IDs from IDs handled by dedicated listeners.
 *
 * Consumers:
 *   - scripts/extract-menu-ids.ts — regenerates src/shared/menu-ids.json
 *   - src/shared/menuIdExtraction.test.ts — fails when the checked-in JSON
 *     drifts from the Rust sources (audit 20260612 H1: the old generator read
 *     a deleted file and the contract silently rotted for 4 months)
 *   - actionRegistry.test.ts — pins MENU_TO_ACTION bidirectionally to
 *     menu-ids.json's menuIds
 *
 * Adding a Rust menu item therefore forces a choice: map it in
 * menuMapping.ts, or add it to EXCLUDED_MENU_IDS with a reason.
 *
 * @module shared/menuIdExtraction
 */

/** Matches MenuItem::with_id(app, "menu-id", ...) in Rust menu sources. */
const MENU_ITEM_REGEX = /MenuItem::with_id\s*\(\s*app\s*,\s*"([^"]+)"/g;

/**
 * Extract static menu IDs from Rust source text. Dynamic IDs containing
 * `{` placeholders (e.g. recent-file-{n}) are skipped.
 */
export function extractMenuIdsFromRust(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(MENU_ITEM_REGEX)) {
    const id = match[1];
    if (id.includes("{")) continue;
    ids.add(id);
  }
  return Array.from(ids).sort();
}

/**
 * Menu IDs NOT routed through the action registry — each is handled by a
 * dedicated frontend listener (useUnifiedMenuCommands, find bar, view
 * shortcuts, tabs) or natively in Rust. Everything extracted from Rust and
 * not listed here must have a MENU_TO_ACTION mapping.
 */
export const EXCLUDED_MENU_IDS: ReadonlySet<string> = new Set([
  // App/native (handled in Rust or by the OS)
  "about",
  "bring-all-to-front",
  "install-cli",
  "preferences",
  "quit",
  "save-all-quit",
  "report-issue",
  "vmark-help",
  "keyboard-shortcuts",
  // Placeholders for empty dynamic submenus
  "no-recent",
  "no-recent-workspace",
  // File operations (dedicated listeners)
  "new",
  "new-window",
  "open",
  "open-folder",
  "close",
  "close-workspace",
  "save",
  "save-as",
  "move-to",
  "read-only",
  "clear-recent",
  "clear-recent-workspaces",
  "clear-workspace-history",
  "cleanup-images",
  // Export/print (export pipeline listeners)
  "copy-html",
  "export-html",
  "export-pdf",
  "export-pdf-native",
  "export-pandoc-docx",
  "export-pandoc-epub",
  "export-pandoc-hint",
  "export-pandoc-latex",
  "export-pandoc-odt",
  "export-pandoc-rtf",
  "export-pandoc-txt",
  // Find/lint navigation (find bar + lint listeners)
  "find-replace",
  "find-next",
  "find-prev",
  "find-in-files",
  "use-selection-find",
  "lint-next",
  "lint-prev",
  "check-markdown",
  // History
  "view-history",
  "clear-history",
  // View toggles (useViewShortcuts / dedicated listeners)
  "wysiwyg-mode",
  "source-mode",
  "markdown-split",
  "knowledge-base",
  "window-status",
  "focus-mode",
  "typewriter-mode",
  "word-wrap",
  "line-numbers",
  "show-invisibles",
  "diagram-preview",
  "fit-tables",
  "file-explorer",
  "outline",
  "toggle-terminal",
  "quick-open",
  "zoom-in",
  "zoom-out",
  "zoom-actual",
]);

/** Split extracted IDs into registry-routed vs excluded. */
export function partitionMenuIds(allIds: string[]): {
  menuIds: string[];
  excluded: string[];
} {
  const menuIds: string[] = [];
  const excluded: string[] = [];
  for (const id of allIds) {
    (EXCLUDED_MENU_IDS.has(id) ? excluded : menuIds).push(id);
  }
  return { menuIds, excluded };
}
