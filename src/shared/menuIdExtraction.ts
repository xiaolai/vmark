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

/**
 * Matches `MenuItem::with_id(app, "menu-id", ...)` in Rust menu sources.
 *
 * The `&` is REQUIRED, not decorative. Rust accepts both `app` and `&app` for
 * this argument and both spellings ship — `localized/*.rs` uses the bare form,
 * `dynamic.rs` uses `&app`. Anchoring on the bare identifier silently dropped
 * four real static ids (`search-genies`, `no-genies`, `reload-genies`,
 * `open-genies-folder`), so the action-registry contract could not tell whether
 * they were routed. A missing id fails OPEN here: nothing reports it, because
 * the check is "everything extracted must be classified", and an id that was
 * never extracted is never checked.
 */
const MENU_ITEM_REGEX = /MenuItem::with_id\s*\(\s*&?\s*app\s*,\s*"([^"]+)"/g;

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
  // #1354 — Windows-only clipboard menu items, routed through the CommandBus
  // (menu:edit-cut → edit.cut, …). They replace muda's PredefinedMenuItems
  // there: the predefined accelerators intercepted physical Ctrl+C/X/V/A in
  // the Win32 accelerator table and re-emitted them via SendInput, whose
  // synthetic Ctrl-up desynced WebView2's modifier state (swallowed keys).
  "edit-cut",
  "edit-copy",
  "edit-paste",
  "edit-select-all",
  // File operations (dedicated listeners)
  "new",
  "new-window",
  // Routed through the CommandBus (menu:last-used-tab -> tab.lastUsed).
  "last-used-tab",
  // Genie submenu, built dynamically in menu/dynamic.rs. These were INVISIBLE
  // to this list until the extraction regex learned the `&app` form — each is
  // handled, just not through the action registry:
  //   search-genies      dynamic accelerator bound by useGenieShortcuts
  //   reload-genies      dedicated listen("menu:reload-genies") in the same hook
  //   open-genies-folder routed via useCommandBootstrap to genies.openFolder
  //   no-genies          a disabled placeholder; it dispatches nothing
  "search-genies",
  "reload-genies",
  "open-genies-folder",
  "no-genies",
  // Pane commands, routed through the CommandBus (WI-DSPL1.2).
  "split-documents",
  "close-pane",
  "focus-other-pane",
  "sync-pane-scroll",
  // Routed through the CommandBus (menu:new-browser-tab -> browser.newTab), not the
  // editor action registry: it opens a tab, it does not act on a document. It exists as
  // a NATIVE menu item because the embedded browser's WKWebView takes keyboard focus,
  // and a DOM shortcut cannot fire while a page has it (WI-S0.5).
  "new-browser-tab",
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
  "breakdown",
  "focus-mode",
  "typewriter-mode",
  "word-wrap",
  "line-numbers",
  "universal-toolbar",
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
