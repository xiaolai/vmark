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
 * @coordinates-with editorPlugins/linkCommands.ts (link shortcuts)
 * @coordinates-with editorPlugins/bookmarkLinkCommand.ts (bookmark link shortcut)
 * @coordinates-with editorPlugins/inlineMathCommand.ts (inline math shortcut)
 * @coordinates-with editorPlugins/textTransformCommands.ts (text transforms)
 * @coordinates-with editorPlugins/lineOperationCommands.ts (line operations)
 */

import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import { Plugin, PluginKey, type Command, type EditorState } from "@tiptap/pm/state";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { openSourcePeekInline, revertAndCloseSourcePeek } from "@/plugins/sourcePeekInline";
import { guardProseMirrorCommand } from "@/utils/imeGuard";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { expandedToggleMark } from "@/plugins/editorPlugins/expandedToggleMark";
import { triggerPastePlainText } from "@/plugins/markdownPaste/tiptap";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { performUnifiedUndo, performUnifiedRedo } from "@/hooks/useUnifiedHistory";
import { handleRemoveBlockquote } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { escapeMarkBoundary, bindIfKey, wrapWithMultiSelectionGuard } from "./editorPlugins/keymapUtils";
import { handleSmartLinkShortcut, handleUnlinkShortcut, handleWikiLinkShortcut } from "./editorPlugins/linkCommands";
import { handleBookmarkLinkShortcut } from "./editorPlugins/bookmarkLinkCommand";
import { handleInlineMathShortcut } from "./editorPlugins/inlineMathCommand";
import {
  doWysiwygTransformUppercase,
  doWysiwygTransformLowercase,
  doWysiwygTransformTitleCase,
  doWysiwygTransformToggleCase,
} from "./editorPlugins/textTransformCommands";
import {
  doWysiwygMoveLineUp,
  doWysiwygMoveLineDown,
  doWysiwygDuplicateLine,
  doWysiwygDeleteLine,
  doWysiwygJoinLines,
} from "./editorPlugins/lineOperationCommands";


const editorKeymapPluginKey = new PluginKey("editorKeymaps");

export function buildEditorKeymapBindings(): Record<string, Command> {
  const shortcuts = useShortcutsStore.getState();
  const bindings: Record<string, Command> = {};

  bindIfKey(bindings, shortcuts.getShortcut("toggleSidebar"), () => {
    useUIStore.getState().toggleSidebar();
    return true;
  });

  // Note: sourceMode toggle is handled by useViewShortcuts hook at window level
  // to avoid double-toggle when both TipTap keymap and window handler fire

  // --- Inline mark formatting ---
  bindIfKey(
    bindings,
    shortcuts.getShortcut("bold"),
    wrapWithMultiSelectionGuard("bold", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "bold");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("italic"),
    wrapWithMultiSelectionGuard("italic", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "italic");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("code"),
    wrapWithMultiSelectionGuard("code", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "code");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("strikethrough"),
    wrapWithMultiSelectionGuard("strikethrough", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "strike");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("underline"),
    wrapWithMultiSelectionGuard("underline", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "underline");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("highlight"),
    wrapWithMultiSelectionGuard("highlight", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "highlight");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("subscript"),
    wrapWithMultiSelectionGuard("subscript", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "subscript");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("superscript"),
    wrapWithMultiSelectionGuard("superscript", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "superscript");
    })
  );

  // --- Link shortcuts ---
  bindIfKey(
    bindings,
    shortcuts.getShortcut("link"),
    wrapWithMultiSelectionGuard("link", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleSmartLinkShortcut(view);
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("unlink"),
    wrapWithMultiSelectionGuard("unlink", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleUnlinkShortcut(view);
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("wikiLink"),
    wrapWithMultiSelectionGuard("wikiLink", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleWikiLinkShortcut(view);
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("bookmarkLink"),
    wrapWithMultiSelectionGuard("bookmarkLink", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleBookmarkLinkShortcut(view);
    })
  );

  // --- Inline math ---
  bindIfKey(
    bindings,
    shortcuts.getShortcut("inlineMath"),
    wrapWithMultiSelectionGuard("inlineMath", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleInlineMathShortcut(view);
    })
  );

  // --- Paste / Insert ---
  bindIfKey(bindings, shortcuts.getShortcut("pastePlainText"), (_state, _dispatch, view) => {
    if (!view) return false;
    void triggerPastePlainText(view);
    return true;
  });

  // Insert image - emit menu event to trigger the same flow as menu item
  bindIfKey(bindings, shortcuts.getShortcut("insertImage"), () => {
    void getCurrentWebviewWindow().emit("menu:image", getCurrentWebviewWindow().label);
    return true;
  });

  // Blockquote toggle - handle directly to avoid relying on Tauri menu accelerator
  bindIfKey(bindings, shortcuts.getShortcut("blockquote"), (_state, _dispatch, view) => {
    if (!view) return false;
    const editor = (view.dom as HTMLElement & { editor?: TiptapEditor }).editor;
    if (!editor) return false;

    if (editor.isActive("blockquote")) {
      // Remove blockquote - use handleRemoveBlockquote to unwrap the entire blockquote,
      // not just the current selection's block range (important for lists in blockquotes)
      handleRemoveBlockquote(view);
    } else {
      // Add blockquote - use ProseMirror wrap
      const { state, dispatch } = view;
      const { $from, $to } = state.selection;
      const blockquoteType = state.schema.nodes.blockquote;
      if (!blockquoteType) return false;

      // Find if we're inside a list - if so, wrap the entire list
      let wrapDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "bulletList" || node.type.name === "orderedList") {
          wrapDepth = d;
          break;
        }
      }

      let range;
      if (wrapDepth > 0) {
        // Wrap at list level
        const listStart = $from.before(wrapDepth);
        const listEnd = $from.after(wrapDepth);
        range = state.doc.resolve(listStart).blockRange(state.doc.resolve(listEnd));
      } else {
        // Normal block range for non-list content
        range = $from.blockRange($to);
      }

      if (range) {
        try {
          dispatch(state.tr.wrap(range, [{ type: blockquoteType }]));
          view.focus();
        } catch {
          // Wrap failed - might be schema constraint, ignore
        }
      }
    }
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
    return escapeMarkBoundary(view);
  });

  // --- Line operations ---
  bindIfKey(bindings, shortcuts.getShortcut("moveLineUp"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygMoveLineUp(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("moveLineDown"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygMoveLineDown(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("duplicateLine"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygDuplicateLine(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("deleteLine"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygDeleteLine(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("joinLines"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygJoinLines(view);
  });
  // Note: Sort lines are not implemented for WYSIWYG as they work on plain text lines

  // --- Text transformations ---
  bindIfKey(bindings, shortcuts.getShortcut("transformUppercase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformUppercase(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformLowercase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformLowercase(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformTitleCase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformTitleCase(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformToggleCase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformToggleCase(view);
  });

  // --- Unified Undo/Redo ---
  // Uses unified history that works across mode switches.
  // First tries native undo/redo, then falls back to checkpoint-based undo/redo.
  bindings["Mod-z"] = guardProseMirrorCommand(() => {
    return performUnifiedUndo(getCurrentWindowLabel());
  });
  bindings["Mod-Shift-z"] = guardProseMirrorCommand(() => {
    return performUnifiedRedo(getCurrentWindowLabel());
  });
  // Windows/Linux convention: Ctrl+Y for redo (skip on macOS where Cmd+Y = AI Genies)
  if (!isMacPlatform()) {
    bindings["Mod-y"] = guardProseMirrorCommand(() => {
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
        view() {
          return {
            destroy() {
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});

export { expandedToggleMark as expandedToggleMarkTiptap };
