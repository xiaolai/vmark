/**
 * Source Mode Outline Sync Hook
 *
 * Purpose: Bridges outline panel clicks to CodeMirror scroll position in source mode,
 *   and tracks cursor position to highlight the active heading in the outline.
 *
 * Pipeline: Sidebar outline click → Tauri event "outline:scroll-to-heading" →
 *   this hook → find nth heading in CodeMirror doc → scroll to top
 *
 * @coordinates-with useOutlineSync.ts — same event, handles WYSIWYG mode
 * @coordinates-with uiStore.ts — writes activeHeadingLine for outline highlight
 * @module hooks/useSourceOutlineSync
 */

import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EditorView } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import { safeUnlisten } from "@/utils/safeUnlisten";
import { useUIStore } from "@/stores/uiStore";
import { parseFenceDelimiter } from "@/components/Sidebar/outlineUtils";

type CMViewRef = React.RefObject<EditorView | null>;

/**
 * Find the document position of the nth ATX heading.
 * Skips headings inside fenced code blocks.
 * Returns -1 if not found.
 */
export function findNthHeadingPos(doc: Text, targetIndex: number): number {
  let currentIndex = 0;
  let currentFence: string | null = null;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;

    const fence = parseFenceDelimiter(text, currentFence);
    if (fence !== null) {
      currentFence = currentFence === null ? fence : null;
      continue;
    }
    if (currentFence !== null) continue;

    if (/^#{1,6}\s+.+/.test(text)) {
      if (currentIndex === targetIndex) return line.from;
      currentIndex++;
    }
  }

  return -1;
}

/**
 * Find the heading index at or before a given line number.
 * Returns -1 if cursor is before all headings.
 */
export function findHeadingIndexAtLine(doc: Text, cursorLine: number): number {
  let headingIndex = -1;
  let currentFence: string | null = null;

  for (let lineNum = 1; lineNum <= cursorLine; lineNum++) {
    const text = doc.line(lineNum).text;

    const fence = parseFenceDelimiter(text, currentFence);
    if (fence !== null) {
      currentFence = currentFence === null ? fence : null;
      continue;
    }
    if (currentFence !== null) continue;

    if (/^#{1,6}\s+.+/.test(text)) {
      headingIndex++;
    }
  }

  return headingIndex;
}

/**
 * Hook to sync outline sidebar with source editor:
 * 1. Listen for scroll-to-heading events and scroll CodeMirror
 * 2. Track cursor position and update active heading index
 */
export function useSourceOutlineSync(
  viewRef: CMViewRef,
  hidden: boolean
) {
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Listen for outline click → scroll to heading
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;

    const setup = async () => {
      try {
        const unlisten = await listen<{ headingIndex: number }>(
          "outline:scroll-to-heading",
          (event) => {
            if (cancelled) return;
            const view = viewRef.current;
            if (!view) return;

            const pos = findNthHeadingPos(
              view.state.doc,
              event.payload.headingIndex
            );
            if (pos === -1) return;

            view.dispatch({
              selection: { anchor: pos },
              effects: EditorView.scrollIntoView(pos, { y: "start" }),
            });
            view.focus();
          }
        );

        if (cancelled) {
          safeUnlisten(unlisten);
        } else {
          unlistenRef.current = unlisten;
        }
      } catch (error) {
        console.error("Failed to setup source outline scroll listener:", error);
      }
    };

    setup();

    return () => {
      cancelled = true;
      safeUnlisten(unlistenRef.current);
      unlistenRef.current = null;
    };
  }, [viewRef, hidden]);

  // Track cursor → update active heading in outline
  useEffect(() => {
    if (hidden) return;
    const view = viewRef.current;
    if (!view) return;

    let animFrameId: number | null = null;

    const updateActiveHeading = () => {
      const v = viewRef.current;
      if (!v) return;
      const cursorPos = v.state.selection.main.head;
      const lineNum = v.state.doc.lineAt(cursorPos).number;
      const headingIndex = findHeadingIndexAtLine(v.state.doc, lineNum);
      useUIStore.getState().setActiveHeadingLine(headingIndex);
    };

    const handleUpdate = () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(updateActiveHeading);
    };

    const dom = view.dom;
    dom.addEventListener("keyup", handleUpdate);
    dom.addEventListener("mouseup", handleUpdate);

    // Initial update
    updateActiveHeading();

    return () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      dom.removeEventListener("keyup", handleUpdate);
      dom.removeEventListener("mouseup", handleUpdate);
    };
  }, [viewRef, hidden]);
}
