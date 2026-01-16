import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import { Selection, type Command, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { openSourcePeek } from "@/utils/sourcePeek";
import { guardProseMirrorCommand } from "@/utils/imeGuard";
import { canRunActionInMultiSelection } from "@/plugins/toolbarActions/multiSelectionPolicy";
import { getWysiwygMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { expandedToggleMark } from "@/plugins/editorPlugins/expandedToggleMark";
import { findAnyMarkRangeAtCursor } from "@/plugins/syntaxReveal/marks";


function escapeMarkBoundary(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const { $from, empty } = selection;

  if (!empty) return false;

  const pos = $from.pos;
  const anyMarkRange = findAnyMarkRangeAtCursor(
    pos,
    $from as unknown as Parameters<typeof findAnyMarkRangeAtCursor>[1]
  );

  if (!anyMarkRange) {
    if (state.storedMarks && state.storedMarks.length > 0) {
      dispatch(state.tr.setStoredMarks([]));
      return true;
    }
    return false;
  }

  const { from: markFrom, to: markTo } = anyMarkRange;

  if (pos === markTo) {
    dispatch(state.tr.setStoredMarks([]));
    return true;
  }

  if (pos === markFrom) {
    if (markFrom > 1) {
      const tr = state.tr.setSelection(Selection.near(state.doc.resolve(markFrom - 1)));
      tr.setStoredMarks([]);
      dispatch(tr);
    } else {
      dispatch(state.tr.setStoredMarks([]));
    }
    return true;
  }

  const tr = state.tr.setSelection(Selection.near(state.doc.resolve(markTo)));
  tr.setStoredMarks([]);
  dispatch(tr);
  return true;
}

function bindIfKey(binds: Record<string, Command>, key: string, command: Command) {
  if (!key) return;
  binds[key] = guardProseMirrorCommand(command);
}

function wrapWithMultiSelectionGuard(action: string, command: Command): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const multi = getWysiwygMultiSelectionContext(view);
    if (!canRunActionInMultiSelection(action, multi)) return false;
    return command(state, dispatch, view);
  };
}

export const editorKeymapExtension = Extension.create({
  name: "editorKeymaps",
  priority: 1000,
  addProseMirrorPlugins() {
    const shortcuts = useShortcutsStore.getState();
    const bindings: Record<string, Command> = {};

    bindIfKey(bindings, shortcuts.getShortcut("toggleSidebar"), () => {
      useUIStore.getState().toggleSidebar();
      return true;
    });

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
      shortcuts.getShortcut("link"),
      wrapWithMultiSelectionGuard("link", (_state, _dispatch, view) => {
        if (!view) return false;
        return expandedToggleMark(view, "link");
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

    bindIfKey(bindings, shortcuts.getShortcut("sourcePeek"), (_state, _dispatch, view) => {
      if (!view) return false;
      const sourcePeek = useSourcePeekStore.getState();
      if (sourcePeek.isOpen) {
        sourcePeek.close();
        return true;
      }
      const preserveLineBreaks = useSettingsStore.getState().markdown.preserveLineBreaks;
      openSourcePeek(view, { preserveLineBreaks });
      return true;
    });

    bindings.Escape = guardProseMirrorCommand((_state: EditorState, _dispatch, view) => {
      if (!view) return false;
      const sourcePeek = useSourcePeekStore.getState();
      if (sourcePeek.isOpen) {
        sourcePeek.close();
        return true;
      }
      const uiStore = useUIStore.getState();
      if (uiStore.universalToolbarVisible) {
        uiStore.setUniversalToolbarVisible(false);
        return true;
      }
      return escapeMarkBoundary(view);
    });

    return [keymap(bindings)];
  },
});

export { expandedToggleMark as expandedToggleMarkTiptap };
