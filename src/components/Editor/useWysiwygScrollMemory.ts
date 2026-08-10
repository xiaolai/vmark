/**
 * useWysiwygScrollMemory
 *
 * Purpose: remember the WYSIWYG reading position of this editor's tab while it
 * is on screen, so the next mount restores it (#1249).
 *
 * Key decisions:
 *   - Tracking is bound to the SCROLL CONTAINER found from the component's own
 *     wrapper div: `.editor-content` in single-pane mode, the split's preview
 *     slot in split mode.
 *   - It resolves that from a REF, never from `editor.view.dom`. Tiptap v3
 *     hands back a Proxy while the view is unmounted, and every property
 *     access on it THROWS ("the editor view is not available") — which in a
 *     passive effect means the whole surface hits its error boundary. The
 *     wrapper div is plain React, present before any effect runs.
 *   - Disabled while hidden or in preview. A hidden editor's container is being
 *     zeroed by the surface that took its place, and a read-only split preview
 *     must not overwrite the position the editable surface owns.
 *   - The tab id is the one PINNED to this editor (#1081), never the currently
 *     active tab — a late teardown after a tab switch must write to its own tab.
 *
 * @coordinates-with services/editor/scrollPosition.ts — the offset store
 * @coordinates-with TiptapEditor.tsx — sole consumer
 * @module components/Editor/useWysiwygScrollMemory
 */
import { useEffect, type RefObject } from "react";
import { findScrollContainer, trackEditorScroll } from "@/services/editor/scrollPosition";

/** Persist this tab's WYSIWYG scroll offset while the editor is visible. */
export function useWysiwygScrollMemory(
  containerRef: RefObject<HTMLElement | null>,
  tabId: string | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    return trackEditorScroll(findScrollContainer(containerRef.current), tabId, "wysiwyg");
  }, [containerRef, tabId, enabled]);
}
