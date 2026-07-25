/**
 * Purpose: Editor keymap extension for WYSIWYG mode.
 * Composes shortcut bindings from grouped command modules and registers
 * them as a ProseMirror plugin that auto-rebuilds when shortcuts change.
 *
 * Exports:
 * - buildEditorKeymapBindings: Build the full keymap bindings record
 * - editorKeymapExtension: Tiptap Extension wrapping the keymap plugin
 * - expandedToggleMarkTiptap: Re-export for external consumers
 *
 * @coordinates-with shortcutsStore.ts (reads current shortcut bindings)
 * @coordinates-with editorPlugins/keymapUtils.ts (binding helpers)
 * @coordinates-with services/editor/runEditorAction.ts (executor for editor.* actions)
 * @coordinates-with editorPlugins/linkCommands.ts (unlink shortcut — no editor.* command)
 */

import { Extension } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import { Plugin, PluginKey, type Command, type EditorState } from "@tiptap/pm/state";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/settingsStore";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { openSourcePeekInline, revertAndCloseSourcePeek } from "@/plugins/sourcePeekInline";
import { guardProseMirrorCommand } from "@/utils/imeGuard";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { UNDO_CHORD, redoChords } from "@/services/keybinding/undoRedoChords";
import { expandedToggleMark } from "@/plugins/editorPlugins/expandedToggleMark";
import { triggerPastePlainText } from "@/plugins/markdownPaste/tiptap";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { performUnifiedUndo, performUnifiedRedo } from "@/services/history/unifiedHistory";
import { runEditorAction } from "@/services/editor/runEditorAction";

import {
  escapeMarkBoundary,
  collapseNonEmptySelection,
  bindIfKey,
  wrapWithMultiSelectionGuard,
} from "./editorPlugins/keymapUtils";
import { handleUnlinkShortcut } from "./editorPlugins/linkCommands";


const editorKeymapPluginKey = new PluginKey("editorKeymaps");

export function buildEditorKeymapBindings(): Record<string, Command> {
  const shortcuts = useShortcutsStore.getState();
  const bindings: Record<string, Command> = {};

  // Note: toggleSidebar and sourceMode toggles are handled by the useViewShortcuts
  // hook at window level (scope: "global"), NOT here — binding them in the TipTap
  // keymap too would double-toggle when both the keymap and the window handler
  // fire on the same keypress.

  // --- Inline mark formatting ---
  // Each binding keeps its multi-selection guard but routes the terminal action
  // through the shared editor executor (runEditorAction) — the SAME path the menu
  // uses (IME queue, read-only re-validation, isActionExecutable gate). NOT
  // executeCommand: that applies the palette actionAvailability gate, which is
  // stricter and would drop keyboard formatting the executor accepts (WI-4.2).
  bindIfKey(
    bindings,
    shortcuts.getShortcut("bold"),
    wrapWithMultiSelectionGuard("bold", () => {
      runEditorAction("bold", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("italic"),
    wrapWithMultiSelectionGuard("italic", () => {
      runEditorAction("italic", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("code"),
    wrapWithMultiSelectionGuard("code", () => {
      runEditorAction("code", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("strikethrough"),
    wrapWithMultiSelectionGuard("strikethrough", () => {
      runEditorAction("strikethrough", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("underline"),
    wrapWithMultiSelectionGuard("underline", () => {
      runEditorAction("underline", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("highlight"),
    wrapWithMultiSelectionGuard("highlight", () => {
      runEditorAction("highlight", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("subscript"),
    wrapWithMultiSelectionGuard("subscript", () => {
      runEditorAction("subscript", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("superscript"),
    wrapWithMultiSelectionGuard("superscript", () => {
      runEditorAction("superscript", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );

  // --- Link shortcuts ---
  bindIfKey(
    bindings,
    shortcuts.getShortcut("link"),
    wrapWithMultiSelectionGuard("link", () => {
      runEditorAction("link", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  // unlink has no editor.* command (executor gap) — keep the direct handler.
  bindIfKey(
    bindings,
    shortcuts.getShortcut("unlink"),
    wrapWithMultiSelectionGuard("unlink", (_state, _dispatch, view) => {
      /* v8 ignore next -- @preserve wrapWithMultiSelectionGuard already guards !view above */
      if (!view) return false;
      return handleUnlinkShortcut(view);
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("wikiLink"),
    wrapWithMultiSelectionGuard("wikiLink", () => {
      runEditorAction("wikiLink", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("bookmarkLink"),
    wrapWithMultiSelectionGuard("bookmarkLink", () => {
      runEditorAction("bookmark", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );

  // --- Inline math ---
  bindIfKey(
    bindings,
    shortcuts.getShortcut("inlineMath"),
    wrapWithMultiSelectionGuard("inlineMath", () => {
      runEditorAction("insertInlineMath", { windowLabel: getCurrentWindowLabel() });
      return true;
    })
  );

  // --- Paste / Insert ---
  bindIfKey(bindings, shortcuts.getShortcut("pastePlainText"), (_state, _dispatch, view) => {
    if (!view) return false;
    void triggerPastePlainText(view);
    return true;
  });

  // Insert image — route through the executor. `editor.insertImage` runs the
  // same runEditorAction("insertImage") path the menu:image event maps to.
  bindIfKey(bindings, shortcuts.getShortcut("insertImage"), () => {
    runEditorAction("insertImage", { windowLabel: getCurrentWindowLabel() });
    return true;
  });

  // Blockquote toggle — route through the executor. The wysiwyg adapter's
  // toggleBlockquote handles the list-wrapping / full-unwrap logic identically.
  bindIfKey(bindings, shortcuts.getShortcut("blockquote"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("blockquote", { windowLabel: getCurrentWindowLabel() });
    return true;
  });

  // --- Source peek ---
  bindIfKey(bindings, shortcuts.getShortcut("sourcePeek"), (_state, _dispatch, view) => {
    if (!view) return false;
    const sourcePeek = useSourcePeekStore.getState();
    if (sourcePeek.isOpen) {
      // Close inline Source Peek with revert
      revertAndCloseSourcePeek(view);
      return true;
    }
    // Open inline Source Peek (returns false for excluded block types)
    return openSourcePeekInline(view);
  });

  // --- Escape key ---
  bindings.Escape = guardProseMirrorCommand((_state: EditorState, _dispatch, view) => {
    if (!view) return false;
    const sourcePeek = useSourcePeekStore.getState();
    if (sourcePeek.isOpen) {
      // Close inline Source Peek with revert
      revertAndCloseSourcePeek(view);
      return true;
    }
    const uiStore = useUIStore.getState();
    if (uiStore.universalToolbarVisible) {
      uiStore.setUniversalToolbarVisible(false);
      return true;
    }
    // Collapse a non-empty range (e.g. whole-doc after Cmd+A) to a cursor
    // so users can dismiss a selection without typing or clicking.
    // Skipped for multi-cursor selections — the multi-cursor keymap's own
    // Escape handler reduces them to the primary range first.
    if (collapseNonEmptySelection(view)) return true;
    return escapeMarkBoundary(view);
  });

  // --- Line operations ---
  bindIfKey(bindings, shortcuts.getShortcut("moveLineUp"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("moveLineUp", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  bindIfKey(bindings, shortcuts.getShortcut("moveLineDown"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("moveLineDown", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  bindIfKey(bindings, shortcuts.getShortcut("duplicateLine"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("duplicateLine", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  bindIfKey(bindings, shortcuts.getShortcut("deleteLine"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("deleteLine", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  bindIfKey(bindings, shortcuts.getShortcut("joinLines"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("joinLines", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  // Note: Sort lines are not implemented for WYSIWYG as they work on plain text lines

  // --- Text transformations ---
  bindIfKey(bindings, shortcuts.getShortcut("transformUppercase"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("transformUppercase", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformLowercase"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("transformLowercase", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformTitleCase"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("transformTitleCase", { windowLabel: getCurrentWindowLabel() });
    return true;
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformToggleCase"), (_state, _dispatch, view) => {
    if (!view) return false;
    runEditorAction("transformToggleCase", { windowLabel: getCurrentWindowLabel() });
    return true;
  });

  // --- Unified Undo/Redo ---
  // Uses unified history that works across mode switches. Chords come from the
  // single source of truth (undoRedoChords.ts) so WYSIWYG + Source can't drift;
  // Mod-y is added off-mac only (macOS reserves Cmd+Y for the AI genie picker).
  bindings[UNDO_CHORD] = guardProseMirrorCommand(() => {
    return performUnifiedUndo(getCurrentWindowLabel());
  });
  for (const chord of redoChords(isMacPlatform())) {
    bindings[chord] = guardProseMirrorCommand(() => {
      return performUnifiedRedo(getCurrentWindowLabel());
    });
  }

  return bindings;
}

export const editorKeymapExtension = Extension.create({
  name: "editorKeymaps",
  priority: 1000,
  addProseMirrorPlugins() {
    let handler = keydownHandler(buildEditorKeymapBindings());
    const unsubscribe = useShortcutsStore.subscribe(() => {
      handler = keydownHandler(buildEditorKeymapBindings());
    });

    return [
      new Plugin({
        key: editorKeymapPluginKey,
        props: {
          handleKeyDown(view, event) {
            return handler(view, event);
          },
        },
        /* v8 ignore start -- @preserve reason: ProseMirror Plugin view() lifecycle only runs inside a live Tiptap editor; not instantiated in unit tests */
        view() {
          return {
            destroy() {
              unsubscribe();
            },
          };
        },
        /* v8 ignore stop */
      }),
    ];
  },
});

export { expandedToggleMark as expandedToggleMarkTiptap };
