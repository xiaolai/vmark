import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { isTerminalFocused } from "@/utils/focus";

const MAX_LINE_SEARCH_ITERATIONS = 500;

function findWordBoundaries(text: string, pos: number): { start: number; end: number } | null {
  if (pos < 0 || pos > text.length) return null;
  const wordChar = /[\p{L}\p{N}_]/u;

  let start = pos;
  let end = pos;

  while (start > 0 && wordChar.test(text[start - 1])) start--;
  while (end < text.length && wordChar.test(text[end])) end++;
  if (start === end) return null;
  return { start, end };
}

function findLineBoundaries(view: EditorView, from: number, to: number): { start: number; end: number } {
  const fromCoords = view.coordsAtPos(from);
  const docSize = view.state.doc.content.size;
  let lineStart = from;
  let lineEnd = to;

  for (let i = 0, pos = from - 1; pos >= 0 && i < MAX_LINE_SEARCH_ITERATIONS; pos--, i++) {
    try {
      const coords = view.coordsAtPos(pos);
      if (Math.abs(coords.top - fromCoords.top) > 2) break;
      lineStart = pos;
    } catch {
      break;
    }
  }

  for (let i = 0, pos = to + 1; pos <= docSize && i < MAX_LINE_SEARCH_ITERATIONS; pos++, i++) {
    try {
      const coords = view.coordsAtPos(pos);
      if (Math.abs(coords.top - fromCoords.top) > 2) break;
      lineEnd = pos;
    } catch {
      break;
    }
  }

  return { start: lineStart, end: lineEnd };
}

export function useTiptapSelectionCommands(editor: TiptapEditor | null) {
  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      const unlistenSelectWord = await currentWindow.listen<string>("menu:select-word", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const { state } = view;
        const { $from } = state.selection;

        const parent = $from.parent;
        if (!parent.isTextblock) return;

        const boundaries = findWordBoundaries(parent.textContent, $from.parentOffset);
        if (!boundaries) return;

        const blockStart = $from.start();
        const from = blockStart + boundaries.start;
        const to = blockStart + boundaries.end;

        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
        view.focus();
      });
      if (cancelled) {
        unlistenSelectWord();
        return;
      }
      unlistenRefs.current.push(unlistenSelectWord);

      const unlistenSelectLine = await currentWindow.listen<string>("menu:select-line", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const { state } = view;
        const { $from, $to } = state.selection;

        const { start, end } = findLineBoundaries(view, $from.pos, $to.pos);
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
        view.focus();
      });
      if (cancelled) {
        unlistenSelectLine();
        return;
      }
      unlistenRefs.current.push(unlistenSelectLine);

      const unlistenSelectBlock = await currentWindow.listen<string>("menu:select-block", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const { state } = view;
        const { $from } = state.selection;

        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.isBlock && !node.isTextblock) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(depth), $from.end(depth))));
            view.focus();
            return;
          }
          if (node.isTextblock) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(depth), $from.end(depth))));
            view.focus();
            return;
          }
          depth--;
        }
      });
      if (cancelled) {
        unlistenSelectBlock();
        return;
      }
      unlistenRefs.current.push(unlistenSelectBlock);

      const unlistenExpandSelection = await currentWindow.listen<string>("menu:expand-selection", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const { state } = view;
        const { from, to, $from } = state.selection;

        if (from === to && $from.parent.isTextblock) {
          const boundaries = findWordBoundaries($from.parent.textContent, $from.parentOffset);
          if (boundaries) {
            const blockStart = $from.start();
            const wordFrom = blockStart + boundaries.start;
            const wordTo = blockStart + boundaries.end;
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, wordFrom, wordTo)));
            view.focus();
            return;
          }
        }

        const { start: lineStart, end: lineEnd } = findLineBoundaries(view, from, to);
        if (lineStart < from || lineEnd > to) {
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, lineStart, lineEnd)));
          view.focus();
          return;
        }

        for (let depth = $from.depth; depth >= 0; depth--) {
          const start = $from.start(depth);
          const end = $from.end(depth);
          if (start < from || end > to) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
            view.focus();
            return;
          }
        }

        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)));
        view.focus();
      });
      if (cancelled) {
        unlistenExpandSelection();
        return;
      }
      unlistenRefs.current.push(unlistenExpandSelection);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}
