/**
 * Outline Sync Hook
 *
 * Purpose: Scrolls the editor to a heading when the user clicks an item
 *   in the sidebar outline panel — bridges outline UI events to editor
 *   scroll position.
 *
 * Pipeline: Sidebar outline click → Tauri event "outline:navigate" →
 *   this hook → find nth heading in ProseMirror doc → scroll into view
 *
 * Key decisions:
 *   - Polls for editor readiness (100ms intervals, 5s max) for lazy-loaded editors
 *   - Scrolls heading to top of viewport using native DOM scrollIntoView
 *   - Also handles sync from outline panel toggle via uiStore
 *   - Cursor tracking uses a 250ms debounce (not rAF) to limit O(headings) traversal to ≤4x/sec
 *
 * @coordinates-with uiStore.ts — reads outline panel visibility
 * @module hooks/useOutlineSync
 */

import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import { outlineSyncError } from "@/utils/debug";
import { useUIStore } from "@/stores/uiStore";
import { getTiptapEditorDom } from "@/utils/tiptapView";
import { safeUnlisten } from "@/utils/safeUnlisten";

type EditorViewGetter = () => EditorView | null;

// Constants
const EDITOR_POLL_INTERVAL_MS = 100;
const EDITOR_POLL_MAX_ATTEMPTS = 50; // 5 seconds max

/**
 * Find the position of the nth heading in a ProseMirror document.
 * Returns -1 if not found.
 */
function findHeadingPosition(doc: Node, targetIndex: number): number {
  let pos = -1;
  let currentIndex = 0;

  doc.descendants((node, nodePos) => {
    if (pos !== -1) return false; // Already found

    if (node.type.name === "heading") {
      if (currentIndex === targetIndex) {
        pos = nodePos;
        return false;
      }
      currentIndex++;
    }
    return true;
  });

  return pos;
}

/**
 * Find the heading index at or before a given position.
 * Returns -1 if cursor is before all headings.
 */
function findHeadingIndexAtPosition(doc: Node, cursorPos: number): number {
  let headingIndex = -1;
  let currentIndex = 0;

  doc.descendants((node, nodePos) => {
    if (node.type.name === "heading") {
      if (nodePos < cursorPos) {
        headingIndex = currentIndex;
        currentIndex++;
      } else {
        return false; // Stop when we pass cursor
      }
    }
    return true;
  });

  return headingIndex;
}

/**
 * Hook to sync outline sidebar with editor:
 * 1. Listen for scroll-to-heading events and scroll editor
 * 2. Track cursor position and update active heading index
 */
export function useOutlineSync(getEditorView: EditorViewGetter) {
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const domRef = useRef<HTMLElement | null>(null);
  const handlersRef = useRef<{ keyup: () => void; mouseup: () => void } | null>(null);

  // Listen for outline:scroll-to-heading events
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const unlisten = await listen<{ headingIndex: number }>(
          "outline:scroll-to-heading",
          (event) => {
            if (cancelled) return;

            const { headingIndex } = event.payload;
            const view = getEditorView();
            if (!view) return;

            const { doc } = view.state;

            const pos = findHeadingPosition(doc, headingIndex);
            if (pos === -1) return;

            // Set selection without ProseMirror's scrollIntoView (which only
            // scrolls the minimum to bring the element into view — not centered).
            const tr = view.state.tr
              .setSelection(Selection.near(doc.resolve(pos + 1)))
              .setMeta("addToHistory", false); // Navigation shouldn't add to undo history
            view.dispatch(tr);
            view.focus();

            // Scroll heading to top of viewport using native DOM API
            requestAnimationFrame(() => {
              const headingDOM = view.nodeDOM(pos);
              if (headingDOM instanceof HTMLElement) {
                headingDOM.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            });
          }
        );

        // Check if cancelled while awaiting - cleanup immediately
        if (cancelled) {
          safeUnlisten(unlisten);
        } else {
          unlistenRef.current = unlisten;
        }
      } catch (error) {
        outlineSyncError("Failed to setup outline scroll listener:", error);
      }
    };

    setup().catch((error) => {
      outlineSyncError("Failed to setup outline scroll listener:", error);
    });

    return () => {
      cancelled = true;
      safeUnlisten(unlistenRef.current);
      unlistenRef.current = null;
    };
  }, [getEditorView]);

  // Track cursor position and update active heading index
  useEffect(() => {
    let cancelled = false;
    let debounceTimerId: ReturnType<typeof setTimeout> | null = null;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const OUTLINE_DEBOUNCE_MS = 250;

    const updateActiveHeading = () => {
      const view = getEditorView();
      const dom = getTiptapEditorDom(view);
      if (!view || !dom || cancelled) return;

      const { selection, doc } = view.state;
      const headingIndex = findHeadingIndexAtPosition(doc, selection.anchor);
      useUIStore.getState().setActiveHeadingLine(headingIndex);
    };

    const handleUpdate = () => {
      if (debounceTimerId) clearTimeout(debounceTimerId);
      debounceTimerId = setTimeout(updateActiveHeading, OUTLINE_DEBOUNCE_MS);
    };

    const setupListeners = () => {
      const view = getEditorView();
      const dom = getTiptapEditorDom(view);
      if (!view || !dom) {
        // Editor not ready, poll until available or max attempts reached
        attempts++;
        if (attempts < EDITOR_POLL_MAX_ATTEMPTS && !cancelled) {
          pollTimeoutId = setTimeout(setupListeners, EDITOR_POLL_INTERVAL_MS);
        }
        return;
      }

      // Capture DOM reference for cleanup
      domRef.current = dom;
      handlersRef.current = { keyup: handleUpdate, mouseup: handleUpdate };

      dom.addEventListener("keyup", handleUpdate);
      dom.addEventListener("mouseup", handleUpdate);

      // Initial update
      updateActiveHeading();
    };

    setupListeners();

    return () => {
      cancelled = true;
      if (debounceTimerId) clearTimeout(debounceTimerId);
      if (pollTimeoutId) clearTimeout(pollTimeoutId);

      // Remove from the exact DOM we attached to
      if (domRef.current && handlersRef.current) {
        domRef.current.removeEventListener("keyup", handlersRef.current.keyup);
        domRef.current.removeEventListener("mouseup", handlersRef.current.mouseup);
      }
      domRef.current = null;
      handlersRef.current = null;
    };
  }, [getEditorView]);
}
