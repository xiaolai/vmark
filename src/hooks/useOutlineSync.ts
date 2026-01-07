import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import { useUIStore } from "@/stores/uiStore";
import { getTiptapEditorDom } from "@/utils/tiptapView";

type EditorViewGetter = () => EditorView | null;

// Constants
const SCROLL_OFFSET_PX = 100;
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
            const dom = getTiptapEditorDom(view);
            if (!view || !dom) return;

            const { doc } = view.state;

            const pos = findHeadingPosition(doc, headingIndex);
            if (pos === -1) return;

            const scrollContainer = dom.closest(".editor-content") as HTMLElement | null;
            try {
              const coords = view.coordsAtPos(pos);
              if (scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const scrollTop = coords.top - containerRect.top - SCROLL_OFFSET_PX;

                scrollContainer.scrollTo({
                  top: Math.max(0, scrollContainer.scrollTop + scrollTop),
                  behavior: "smooth",
                });
              }
            } catch {
              // Ignore coords errors
            }

            const tr = view.state.tr.setSelection(Selection.near(doc.resolve(pos + 1)));
            view.dispatch(tr.scrollIntoView());
            view.focus();
          }
        );

        // Check if cancelled while awaiting - cleanup immediately
        if (cancelled) {
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      } catch (error) {
        console.error("Failed to setup outline scroll listener:", error);
      }
    };

    setup();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [getEditorView]);

  // Track cursor position and update active heading index
  useEffect(() => {
    let cancelled = false;
    let animationFrameId: number | null = null;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const updateActiveHeading = () => {
      const view = getEditorView();
      const dom = getTiptapEditorDom(view);
      if (!view || !dom || cancelled) return;

      const { selection, doc } = view.state;
      const headingIndex = findHeadingIndexAtPosition(doc, selection.anchor);
      useUIStore.getState().setActiveHeadingLine(headingIndex);
    };

    const handleUpdate = () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(updateActiveHeading);
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
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
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
