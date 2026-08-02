/**
 * Source Mode Keyboard Shortcuts
 *
 * Purpose: Defines all keyboard shortcuts for Source mode (CodeMirror 6), mapping
 * user-configurable shortcuts from shortcutsStore to Source-specific actions.
 *
 * Pipeline: shortcutsStore -> getSourceKeybindings() -> CodeMirror keymap extension
 *
 * Key decisions:
 *   - Shortcuts are resolved lazily from the store so user customizations take effect immediately
 *   - Smart select-all lives in `sourceSmartSelect.ts` — the one binding
 *     with state and logic; this file is a flat key-to-action table
 *   - EVERY document mutation routes through the shared executor
 *     (runEditorAction, the menu's path — NOT executeCommand; WI-4.2). The last
 *     exception, `unlink`, had no `editor.*` action though both adapters
 *     implemented it; adding the ActionId closed the gap (WI-2.1). Direct
 *     handlers remain only for non-mutations — find/search, copy-as-HTML —
 *     gated by `__tests__/dispatchBoundary.test.ts`
 *   - Helper functions are extracted to sourceShortcutsHelpers.ts to keep this file focused
 *
 * Known limitations:
 *   - Some shortcuts overlap with system keybindings on different platforms
 *
 * @coordinates-with stores/shortcutsStore.ts — source of shortcut key definitions
 * @coordinates-with services/editor/runEditorAction.ts — executor for editor.* actions
 * @coordinates-with plugins/actions/types.ts — the ActionId union the bindings use
 * @coordinates-with plugins/codemirror/sourceShortcutsHelpers.ts — helper functions
 * @module plugins/codemirror/sourceShortcuts
 */

import type { KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { toggleBlockComment, selectLine } from "@codemirror/commands";
import { hostShortcuts } from "@/plugins/shared/hostShortcuts";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { addSmartSelectBindings, getSourceBlockBounds } from "./sourceSmartSelect";

// Re-exported: the block-bounds helper is part of this module's public surface.
export { getSourceBlockBounds };
import { runEditorAction } from "@/services/editor/runEditorAction";
import type { ActionId, HeadingLevel } from "@/plugins/actions/types";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import {
  openFindBar,
  findNextMatch,
  findPreviousMatch,
  copySelectionAsHtml,
} from "./sourceShortcutsHelpers";

/**
 * CodeMirror command running an action through the shared executor
 * (`runEditorAction`, the menu's path — NOT `executeCommand`, whose stricter
 * palette gate would drop keyboard formatting; WI-4.2).
 *
 * Takes a TYPED `ActionId`. It previously took a `"editor.foo"` string and cast
 * the remainder with `as ActionId`, which defeated the action system's whole
 * type guarantee: a typo compiled, the executor found no such action, and the
 * binding still returned true — so the key was consumed and nothing happened,
 * which is indistinguishable from a broken keyboard.
 */
function runCommand(actionId: ActionId): (view: EditorView) => boolean {
  return () => {
    runEditorAction(actionId, { windowLabel: getCurrentWindowLabel() });
    return true;
  };
}

/** `setHeading` carries its level as a parameter, so it has its own helper. */
function runHeading(level: HeadingLevel): (view: EditorView) => boolean {
  return () => {
    runEditorAction("setHeading", {
      windowLabel: getCurrentWindowLabel(),
      params: { level },
    });
    return true;
  };
}

function bindIfKey(bindings: KeyBinding[], key: string, run: (view: EditorView) => boolean) {
  if (!key) return;
  bindings.push(
    guardCodeMirrorKeyBinding({
      key,
      run,
      preventDefault: true,
    })
  );
}

export function buildSourceShortcutKeymap(): KeyBinding[] {
  const shortcuts = hostShortcuts;
  const bindings: KeyBinding[] = [];

  // --- View shortcuts ---
  // toggleSidebar is NOT bound here. It is scope:"global", handled at window
  // level by the view keybindings, and the WYSIWYG keymap already excludes it
  // for the same reason — `shortcutDefinitions.ts` states the rule outright:
  // "handled in useViewShortcuts only, never the TipTap keymap, to avoid
  // double-toggle". Source was the one surface that did bind it, so both
  // handlers fired and the sidebar toggled twice — appearing to do nothing.

  // Capture sourceMode shortcut to prevent CodeMirror's default comment toggle.
  // The actual toggle is handled by useViewShortcuts hook at window level.
  bindIfKey(bindings, shortcuts.getShortcut("sourceMode"), () => {
    // Just mark as handled - window handler does the actual toggle
    return true;
  });

  // --- Inline formatting (routed through the executor; see runCommand) ---
  bindIfKey(bindings, shortcuts.getShortcut("bold"), runCommand("bold"));
  bindIfKey(bindings, shortcuts.getShortcut("italic"), runCommand("italic"));
  bindIfKey(bindings, shortcuts.getShortcut("code"), runCommand("code"));
  bindIfKey(bindings, shortcuts.getShortcut("strikethrough"), runCommand("strikethrough"));
  bindIfKey(bindings, shortcuts.getShortcut("underline"), runCommand("underline"));
  bindIfKey(bindings, shortcuts.getShortcut("link"), runCommand("link"));
  bindIfKey(bindings, shortcuts.getShortcut("unlink"), runCommand("unlink"));
  bindIfKey(bindings, shortcuts.getShortcut("wikiLink"), runCommand("wikiLink"));
  bindIfKey(bindings, shortcuts.getShortcut("bookmarkLink"), runCommand("bookmark"));
  bindIfKey(bindings, shortcuts.getShortcut("highlight"), runCommand("highlight"));
  bindIfKey(bindings, shortcuts.getShortcut("subscript"), runCommand("subscript"));
  bindIfKey(bindings, shortcuts.getShortcut("superscript"), runCommand("superscript"));
  bindIfKey(bindings, shortcuts.getShortcut("inlineMath"), runCommand("insertInlineMath"));
  bindIfKey(bindings, shortcuts.getShortcut("clearFormat"), runCommand("clearFormatting"));
  // toggleComment has no editor.* command — keep the CodeMirror command directly.
  bindIfKey(bindings, shortcuts.getShortcut("toggleComment"), (view) => toggleBlockComment(view));

  // --- Block formatting: Headings ---
  bindIfKey(bindings, shortcuts.getShortcut("heading1"), runHeading(1));
  bindIfKey(bindings, shortcuts.getShortcut("heading2"), runHeading(2));
  bindIfKey(bindings, shortcuts.getShortcut("heading3"), runHeading(3));
  bindIfKey(bindings, shortcuts.getShortcut("heading4"), runHeading(4));
  bindIfKey(bindings, shortcuts.getShortcut("heading5"), runHeading(5));
  bindIfKey(bindings, shortcuts.getShortcut("heading6"), runHeading(6));
  bindIfKey(bindings, shortcuts.getShortcut("paragraph"), runCommand("paragraph"));
  bindIfKey(bindings, shortcuts.getShortcut("increaseHeading"), runCommand("increaseHeading"));
  bindIfKey(bindings, shortcuts.getShortcut("decreaseHeading"), runCommand("decreaseHeading"));

  // --- Block formatting: Lists ---
  bindIfKey(bindings, shortcuts.getShortcut("bulletList"), runCommand("bulletList"));
  bindIfKey(bindings, shortcuts.getShortcut("orderedList"), runCommand("orderedList"));
  bindIfKey(bindings, shortcuts.getShortcut("taskList"), runCommand("taskList"));
  bindIfKey(bindings, shortcuts.getShortcut("indent"), runCommand("indent"));
  bindIfKey(bindings, shortcuts.getShortcut("outdent"), runCommand("outdent"));

  // --- Block formatting: Other blocks ---
  bindIfKey(bindings, shortcuts.getShortcut("blockquote"), runCommand("blockquote"));
  bindIfKey(bindings, shortcuts.getShortcut("codeBlock"), runCommand("codeBlock"));
  bindIfKey(bindings, shortcuts.getShortcut("mathBlock"), runCommand("insertMath"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTable"), runCommand("insertTable"));
  bindIfKey(bindings, shortcuts.getShortcut("formatTable"), runCommand("formatTable"));
  bindIfKey(bindings, shortcuts.getShortcut("horizontalLine"), runCommand("horizontalLine"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImage"), runCommand("insertImage"));

  // --- Block formatting: Alerts and details ---
  bindIfKey(bindings, shortcuts.getShortcut("insertNote"), runCommand("insertAlertNote"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTip"), runCommand("insertAlertTip"));
  bindIfKey(bindings, shortcuts.getShortcut("insertWarning"), runCommand("insertAlertWarning"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImportant"), runCommand("insertAlertImportant"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCaution"), runCommand("insertAlertCaution"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCollapsible"), runCommand("insertDetails"));

  // --- Navigation ---
  bindIfKey(bindings, shortcuts.getShortcut("selectLine"), (view) => selectLine(view));
  bindIfKey(bindings, shortcuts.getShortcut("findReplace"), () => openFindBar());
  bindIfKey(bindings, shortcuts.getShortcut("findNext"), findNextMatch);
  bindIfKey(bindings, shortcuts.getShortcut("findPrevious"), findPreviousMatch);

  // --- Editing ---
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKSelection"), runCommand("formatCJK"));
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKFile"), runCommand("formatCJKFile"));
  // copyAsHTML has no editor.* command — keep the source helper directly.
  bindIfKey(bindings, shortcuts.getShortcut("copyAsHTML"), copySelectionAsHtml);

  // --- Line operations ---
  bindIfKey(bindings, shortcuts.getShortcut("moveLineUp"), runCommand("moveLineUp"));
  bindIfKey(bindings, shortcuts.getShortcut("moveLineDown"), runCommand("moveLineDown"));
  bindIfKey(bindings, shortcuts.getShortcut("duplicateLine"), runCommand("duplicateLine"));
  bindIfKey(bindings, shortcuts.getShortcut("deleteLine"), runCommand("deleteLine"));
  bindIfKey(bindings, shortcuts.getShortcut("joinLines"), runCommand("joinLines"));
  bindIfKey(bindings, shortcuts.getShortcut("sortLinesAsc"), runCommand("sortLinesAsc"));
  bindIfKey(bindings, shortcuts.getShortcut("sortLinesDesc"), runCommand("sortLinesDesc"));

  // --- Text transformations ---
  bindIfKey(bindings, shortcuts.getShortcut("transformUppercase"), runCommand("transformUppercase"));
  bindIfKey(bindings, shortcuts.getShortcut("transformLowercase"), runCommand("transformLowercase"));
  bindIfKey(bindings, shortcuts.getShortcut("transformTitleCase"), runCommand("transformTitleCase"));
  bindIfKey(bindings, shortcuts.getShortcut("transformToggleCase"), runCommand("transformToggleCase"));

  addSmartSelectBindings(bindings);

  return bindings;
}
