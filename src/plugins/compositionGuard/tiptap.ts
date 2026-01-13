import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  flushProseMirrorCompositionQueue,
  getImeCleanupPrefixLength,
  isImeKeyEvent,
  isProseMirrorInCompositionGrace,
  markProseMirrorCompositionEnd,
} from "@/utils/imeGuard";

export const compositionGuardExtension = Extension.create({
  name: "compositionGuard",
  priority: 1200,
  addProseMirrorPlugins() {
    let isComposing = false;
    let compositionStartPos: number | null = null;
    let compositionData = "";

    const findTableCellDepth = (view: EditorView, pos: number): number | null => {
      const { doc } = view.state;
      const $pos = doc.resolve(pos);
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);
        if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
          return depth;
        }
      }
      return null;
    };

    const scheduleImeCleanup = (view: EditorView) => {
      if (!compositionData || compositionStartPos === null) return;

      const { state } = view;
      let $start;
      try {
        $start = state.doc.resolve(compositionStartPos);
      } catch {
        return;
      }

      let cleanupEnd = $start.end();
      let allowNewlines = false;

      if ($start.parent.type.name === "heading") {
        cleanupEnd = $start.end();
      } else {
        const tableDepth = findTableCellDepth(view, compositionStartPos);
        if (tableDepth === null) return;
        cleanupEnd = $start.end(tableDepth);
        allowNewlines = true;
      }

      if (compositionStartPos > cleanupEnd) return;

      const textBetween = state.doc.textBetween(compositionStartPos, cleanupEnd, "\n");
      const prefixLen = getImeCleanupPrefixLength(textBetween, compositionData, { allowNewlines });
      if (!prefixLen) return;

      const deleteFrom = compositionStartPos;
      const deleteTo = compositionStartPos + prefixLen;
      view.dispatch(state.tr.delete(deleteFrom, deleteTo).setMeta("uiEvent", "composition-cleanup"));
    };

    return [
      new Plugin({
        filterTransaction(tr) {
          if (!isComposing) return true;

          const compositionMeta = tr.getMeta("composition");
          const uiEvent = tr.getMeta("uiEvent");
          if (compositionMeta) return true;
          if (uiEvent === "input" || uiEvent === "composition") return true;

          return false;
        },
        props: {
          handleKeyDown(view, event) {
            if (isImeKeyEvent(event)) return true;
            if (isProseMirrorInCompositionGrace(view)) return true;
            return false;
          },
          handleDOMEvents: {
            compositionstart(view) {
              isComposing = true;
              compositionStartPos = view.state.selection.from;
              compositionData = "";
              return false;
            },
            compositionupdate(_view, event) {
              compositionData = (event as CompositionEvent).data ?? compositionData;
              return false;
            },
            compositionend(view, event) {
              isComposing = false;
              markProseMirrorCompositionEnd(view);
              const data = (event as CompositionEvent).data;
              if (typeof data === "string" && data.length > 0) {
                compositionData = data;
              }

              requestAnimationFrame(() => {
                scheduleImeCleanup(view);
                flushProseMirrorCompositionQueue(view);
              });

              return false;
            },
            blur(view) {
              if (!isComposing) return false;
              isComposing = false;
              compositionStartPos = null;
              compositionData = "";
              markProseMirrorCompositionEnd(view);
              requestAnimationFrame(() => {
                flushProseMirrorCompositionQueue(view);
              });
              return false;
            },
          },
        },
      }),
    ];
  },
});
