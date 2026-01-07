import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import { Selection, type Command, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useUIStore } from "@/stores/uiStore";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { findAnyMarkRangeAtCursor, findMarkRange } from "@/plugins/syntaxReveal/marks";
import { openSourcePeek } from "@/utils/sourcePeek";

interface LastRemovedMark {
  markType: string;
  from: number;
  to: number;
  docTextHash: number;
}

const lastRemovedMarkMap = new WeakMap<EditorView, LastRemovedMark | null>();

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

function expandedToggleMark(view: EditorView, markTypeName: string): boolean {
  const { state, dispatch } = view;
  const markType = state.schema.marks[markTypeName];
  if (!markType) return false;

  const { from, to, empty } = state.selection;
  const $from = state.selection.$from;
  const docTextHash = hashString(state.doc.textContent);

  const lastRemovedMark = lastRemovedMarkMap.get(view) ?? null;

  const clearLastRemoved = () => {
    lastRemovedMarkMap.set(view, null);
  };

  const setLastRemoved = (mark: LastRemovedMark) => {
    lastRemovedMarkMap.set(view, mark);
  };

  if (!empty) {
    clearLastRemoved();
    if (state.doc.rangeHasMark(from, to, markType)) {
      dispatch(state.tr.removeMark(from, to, markType));
    } else {
      dispatch(state.tr.addMark(from, to, markType.create()));
    }
    return true;
  }

  const markRange = findMarkRange(
    from,
    markType.create(),
    $from.start(),
    $from.parent as unknown as Parameters<typeof findMarkRange>[3]
  );

  if (markRange) {
    setLastRemoved({
      markType: markTypeName,
      from: markRange.from,
      to: markRange.to,
      docTextHash,
    });
    dispatch(state.tr.removeMark(markRange.from, markRange.to, markType));
    return true;
  }

  if (
    lastRemovedMark &&
    lastRemovedMark.markType === markTypeName &&
    lastRemovedMark.docTextHash === docTextHash &&
    from >= lastRemovedMark.from &&
    from <= lastRemovedMark.to
  ) {
    dispatch(state.tr.addMark(lastRemovedMark.from, lastRemovedMark.to, markType.create()));
    clearLastRemoved();
    return true;
  }

  const inheritedRange = findAnyMarkRangeAtCursor(
    from,
    $from as unknown as Parameters<typeof findAnyMarkRangeAtCursor>[1]
  );

  if (inheritedRange && !(markTypeName === "code" && inheritedRange.isLink)) {
    clearLastRemoved();
    dispatch(state.tr.addMark(inheritedRange.from, inheritedRange.to, markType.create()));
    return true;
  }

  clearLastRemoved();
  const storedMarks = state.storedMarks || $from.marks();
  if (markType.isInSet(storedMarks)) {
    dispatch(state.tr.removeStoredMark(markType));
  } else {
    dispatch(state.tr.addStoredMark(markType.create()));
  }
  return true;
}

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
  binds[key] = command;
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

    bindIfKey(bindings, shortcuts.getShortcut("bold"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "bold");
    });
    bindIfKey(bindings, shortcuts.getShortcut("italic"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "italic");
    });
    bindIfKey(bindings, shortcuts.getShortcut("code"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "code");
    });
    bindIfKey(bindings, shortcuts.getShortcut("strikethrough"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "strike");
    });
    bindIfKey(bindings, shortcuts.getShortcut("link"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "link");
    });
    bindIfKey(bindings, shortcuts.getShortcut("highlight"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "highlight");
    });
    bindIfKey(bindings, shortcuts.getShortcut("subscript"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "subscript");
    });
    bindIfKey(bindings, shortcuts.getShortcut("superscript"), (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "superscript");
    });

    bindIfKey(bindings, shortcuts.getShortcut("sourcePeek"), (_state, _dispatch, view) => {
      if (!view) return false;
      const sourcePeek = useSourcePeekStore.getState();
      if (sourcePeek.isOpen) {
        sourcePeek.close();
        return true;
      }
      openSourcePeek(view);
      return true;
    });

    bindings.Escape = (_state: EditorState, _dispatch, view) => {
      if (!view) return false;
      const sourcePeek = useSourcePeekStore.getState();
      if (sourcePeek.isOpen) {
        sourcePeek.close();
        return true;
      }
      const formatStore = useFormatToolbarStore.getState();
      if (formatStore.isOpen) {
        formatStore.closeToolbar();
        return true;
      }
      return escapeMarkBoundary(view);
    };

    return [keymap(bindings)];
  },
});

export { expandedToggleMark as expandedToggleMarkTiptap };
