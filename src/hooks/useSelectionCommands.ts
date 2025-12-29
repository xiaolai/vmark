import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";

type GetEditor = () => Editor | undefined;

// Max iterations for line boundary search (prevents slow loops on very long lines)
const MAX_LINE_SEARCH_ITERATIONS = 500;

/**
 * Find word boundaries around a position
 */
function findWordBoundaries(
  text: string,
  pos: number
): { start: number; end: number } | null {
  if (pos < 0 || pos > text.length) return null;

  // Word characters pattern (includes unicode letters)
  const wordChar = /[\p{L}\p{N}_]/u;

  let start = pos;
  let end = pos;

  // Find start of word
  while (start > 0 && wordChar.test(text[start - 1])) {
    start--;
  }

  // Find end of word
  while (end < text.length && wordChar.test(text[end])) {
    end++;
  }

  // No word found
  if (start === end) return null;

  return { start, end };
}

/**
 * Find visual line boundaries around a position range
 */
function findLineBoundaries(
  view: EditorView,
  from: number,
  to: number
): { start: number; end: number } {
  const fromCoords = view.coordsAtPos(from);
  const docSize = view.state.doc.content.size;
  let lineStart = from;
  let lineEnd = to;

  // Find start of visual line (limited iterations for performance)
  for (let i = 0, pos = from - 1; pos >= 0 && i < MAX_LINE_SEARCH_ITERATIONS; pos--, i++) {
    try {
      const coords = view.coordsAtPos(pos);
      if (Math.abs(coords.top - fromCoords.top) > 2) break;
      lineStart = pos;
    } catch {
      break;
    }
  }

  // Find end of visual line (limited iterations for performance)
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

export function useSelectionCommands(getEditor: GetEditor) {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Select Word (Cmd+D)
      const unlistenSelectWord = await listen("menu:select-word", () => {
        const editor = getEditor();
        if (!editor) return;

        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { $from } = state.selection;

          // Get text content of the current text block
          const parent = $from.parent;
          if (!parent.isTextblock) return;

          const textContent = parent.textContent;
          const offsetInParent = $from.parentOffset;

          const boundaries = findWordBoundaries(textContent, offsetInParent);
          if (!boundaries) return;

          // Calculate document positions
          const blockStart = $from.start();
          const from = blockStart + boundaries.start;
          const to = blockStart + boundaries.end;

          const selection = TextSelection.create(state.doc, from, to);
          view.dispatch(state.tr.setSelection(selection));
        });
      });
      if (cancelled) { unlistenSelectWord(); return; }
      unlistenRefs.current.push(unlistenSelectWord);

      // Select Line (Cmd+L)
      const unlistenSelectLine = await listen("menu:select-line", () => {
        const editor = getEditor();
        if (!editor) return;

        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { $from, $to } = state.selection;

          const { start, end } = findLineBoundaries(view, $from.pos, $to.pos);
          const selection = TextSelection.create(state.doc, start, end);
          view.dispatch(state.tr.setSelection(selection));
        });
      });
      if (cancelled) { unlistenSelectLine(); return; }
      unlistenRefs.current.push(unlistenSelectLine);

      // Select Block (select current paragraph/block node)
      const unlistenSelectBlock = await listen("menu:select-block", () => {
        const editor = getEditor();
        if (!editor) return;

        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { $from } = state.selection;

          // Find the nearest block node
          let depth = $from.depth;
          while (depth > 0) {
            const node = $from.node(depth);
            if (node.isBlock && !node.isTextblock) {
              // For container nodes like list items, select the content
              const start = $from.start(depth);
              const end = $from.end(depth);
              const selection = TextSelection.create(state.doc, start, end);
              view.dispatch(state.tr.setSelection(selection));
              return;
            } else if (node.isTextblock) {
              // For text blocks, select the whole block
              const start = $from.start(depth);
              const end = $from.end(depth);
              const selection = TextSelection.create(state.doc, start, end);
              view.dispatch(state.tr.setSelection(selection));
              return;
            }
            depth--;
          }
        });
      });
      if (cancelled) { unlistenSelectBlock(); return; }
      unlistenRefs.current.push(unlistenSelectBlock);

      // Expand Selection (progressively expand to parent)
      const unlistenExpandSelection = await listen("menu:expand-selection", () => {
        const editor = getEditor();
        if (!editor) return;

        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { from, to, $from } = state.selection;

          // Step 1: If collapsed, select word
          if (from === to) {
            const parent = $from.parent;
            if (parent.isTextblock) {
              const textContent = parent.textContent;
              const offsetInParent = $from.parentOffset;
              const boundaries = findWordBoundaries(textContent, offsetInParent);
              if (boundaries) {
                const blockStart = $from.start();
                const wordFrom = blockStart + boundaries.start;
                const wordTo = blockStart + boundaries.end;
                const selection = TextSelection.create(state.doc, wordFrom, wordTo);
                view.dispatch(state.tr.setSelection(selection));
                return;
              }
            }
          }

          // Step 2: Try to expand to visual line first
          const { start: lineStart, end: lineEnd } = findLineBoundaries(view, from, to);

          // If line is larger than current selection, expand to line
          if (lineStart < from || lineEnd > to) {
            const selection = TextSelection.create(state.doc, lineStart, lineEnd);
            view.dispatch(state.tr.setSelection(selection));
            return;
          }

          // Step 3: Expand to parent nodes progressively
          for (let depth = $from.depth; depth >= 0; depth--) {
            const start = $from.start(depth);
            const end = $from.end(depth);

            // Check if this node is larger than current selection
            if (start < from || end > to) {
              const selection = TextSelection.create(state.doc, start, end);
              view.dispatch(state.tr.setSelection(selection));
              return;
            }
          }

          // Step 4: Select all (already at top level)
          const selection = TextSelection.create(state.doc, 0, state.doc.content.size);
          view.dispatch(state.tr.setSelection(selection));
        });
      });
      if (cancelled) { unlistenExpandSelection(); return; }
      unlistenRefs.current.push(unlistenExpandSelection);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
