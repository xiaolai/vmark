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
 *   - Cursor tracking uses a 250ms debounce (not rAF) to coalesce bursts
 *   - Heading positions are cached in a WeakMap keyed by ProseMirror doc —
 *     transactions create new doc refs, so the cache self-invalidates. Cursor
 *     lookups then use O(log N) binary search on the cached positions array
 *     instead of walking the full doc on every cursor move.
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
 * Heading position cache keyed by doc node. PM docs are immutable, so each
 * transaction produces a new doc reference; WeakMap lets old entries be GC'd
 * when docs are no longer referenced. The cache turns each cursor-move lookup
 * from a full tree walk into an O(log N) binary search on cached positions.
 */
const headingCache: WeakMap<Node, number[]> = new WeakMap();

function getHeadingPositions(doc: Node): number[] {
  const cached = headingCache.get(doc);
  if (cached) return cached;
  const positions: number[] = [];
  doc.descendants((node, nodePos) => {
    if (node.type.name === "heading") positions.push(nodePos);
    return true;
  });
  headingCache.set(doc, positions);
  return positions;
}

/** Find the position of the nth heading; -1 if out of range. */
function findHeadingPosition(doc: Node, targetIndex: number): number {
  const positions = getHeadingPositions(doc);
  return targetIndex >= 0 && targetIndex < positions.length
    ? positions[targetIndex]
    : -1;
}

/**
 * Find the heading index at or before a cursor position using binary search.
 * Returns -1 if the cursor is before every heading.
 */
function findHeadingIndexAtPosition(doc: Node, cursorPos: number): number {
  const positions = getHeadingPositions(doc);
  // Find the largest index where positions[i] < cursorPos.
  let lo = 0;
  let hi = positions.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] < cursorPos) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
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
