import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { keymap } from "@tiptap/pm/keymap";
import type { EditorView } from "@tiptap/pm/view";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import { findWordAtCursor, findAnyMarkRangeAtCursor } from "@/plugins/syntaxReveal/marks";
import { getNodeContext } from "./nodeActions.tiptap";
import { getCodeBlockInfo, getHeadingInfo, getContextMode, getCursorRect, isAtParagraphLineStart } from "./nodeDetection.tiptap";
import { TiptapFormatToolbarView } from "./TiptapFormatToolbarView";

const formatToolbarPluginKey = new PluginKey("tiptapFormatToolbar");

function toggleContextAwareToolbar(view: EditorView): boolean {
  const store = useFormatToolbarStore.getState();
  const { empty, from } = view.state.selection;

  if (store.isOpen) {
    store.closeToolbar();
    view.focus();
    return true;
  }

  const codeBlockInfo = getCodeBlockInfo(view);
  if (codeBlockInfo) {
    store.openCodeToolbar(getCursorRect(view), view as unknown as never, codeBlockInfo);
    return true;
  }

  if (!empty) {
    store.openToolbar(getCursorRect(view), view as unknown as never, "format");
    return true;
  }

  const nodeContext = getNodeContext(view);
  if (nodeContext) {
    store.openMergedToolbar(getCursorRect(view), view as unknown as never, nodeContext);
    return true;
  }

  // Image node has its own click popup
  if (view.state.selection instanceof NodeSelection && view.state.selection.node.type.name === "image") {
    return false;
  }

  // Cursor inside any mark range → auto-select that range and show format toolbar
  const inheritedRange = findAnyMarkRangeAtCursor(
    from,
    view.state.selection.$from as unknown as Parameters<typeof findAnyMarkRangeAtCursor>[1]
  );
  if (inheritedRange) {
    const originalCursorPos = from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inheritedRange.from, inheritedRange.to)));
    store.openToolbar(getCursorRect(view), view as unknown as never, { contextMode: "format", originalCursorPos });
    return true;
  }

  const headingInfo = getHeadingInfo(view);
  if (headingInfo) {
    store.openHeadingToolbar(getCursorRect(view), view as unknown as never, headingInfo);
    return true;
  }

  if (isAtParagraphLineStart(view)) {
    store.openHeadingToolbar(getCursorRect(view), view as unknown as never, {
      level: 0,
      nodePos: view.state.selection.$from.before(view.state.selection.$from.depth),
    });
    return true;
  }

  const wordRange = findWordAtCursor(view.state.selection.$from as unknown as Parameters<typeof findWordAtCursor>[0]);
  if (wordRange) {
    const originalCursorPos = from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, wordRange.from, wordRange.to)));
    store.openToolbar(getCursorRect(view), view as unknown as never, { contextMode: "format", originalCursorPos });
    return true;
  }

  store.openToolbar(getCursorRect(view), view as unknown as never, getContextMode(view));
  return true;
}

export const formatToolbarExtension = Extension.create({
  name: "formatToolbar",
  priority: 1100,
  addProseMirrorPlugins() {
    return [
      keymap({
        "Mod-e": (_state, _dispatch, view) => {
          if (!view) return false;
          return toggleContextAwareToolbar(view as unknown as EditorView);
        },
      }),
      new Plugin({
        key: formatToolbarPluginKey,
        view(editorView) {
          const toolbarView = new TiptapFormatToolbarView(editorView);
          return { destroy: () => toolbarView.destroy() };
        },
      }),
    ];
  },
});
