/**
 * TiptapEditor module helpers
 *
 * Purpose: pure, editor-instance-level helpers extracted from TiptapEditor.tsx —
 * history-free content replacement, adaptive debounce sizing, and external
 * markdown→editor sync. No React state; safe to call from effects and callbacks.
 *
 * @coordinates-with TiptapEditor.tsx — sole consumer; behavior documented there
 * @module components/Editor/tiptapEditorHelpers
 */
import type { MutableRefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { getTiptapEditorView } from "@/services/editor/tiptapView";
import { tiptapError } from "@/utils/debug";

/**
 * Delay before enabling cursor tracking after editor creation.
 * Prevents spurious cursor sync during initial render/focus.
 */
export const CURSOR_TRACKING_DELAY_MS = 200;

/**
 * Set editor content without adding to undo history.
 * Tiptap's setContent in v3.x does NOT exclude from history by default,
 * so we use a direct ProseMirror transaction with addToHistory: false.
 */
export function setContentWithoutHistory(editor: TiptapEditor, doc: PMNode): void {
  const view = getTiptapEditorView(editor);
  if (!view) {
    // Fallback to standard setContent if view not available
    editor.commands.setContent(doc, { emitUpdate: false });
    return;
  }

  const { state } = view;
  const tr = state.tr
    .replaceWith(0, state.doc.content.size, doc.content)
    .setMeta("addToHistory", false)
    .setMeta("preventUpdate", true); // Don't emit update event
  view.dispatch(tr);
}

/**
 * Calculate adaptive debounce delay based on document size.
 * Larger documents get longer delays to reduce parsing overhead during typing.
 *
 * @param docSize - Document size in characters
 * @returns Delay in milliseconds
 */
export function getAdaptiveDebounceDelay(docSize: number): number {
  if (docSize > 1000000) return 5000; // 1M+: 5s (~1MB+ markdown)
  if (docSize > 500000) return 2000;  // 500K+: 2s
  if (docSize > 100000) return 1000;  // 100K+: 1s
  if (docSize > 50000) return 500;    // 50K+: 500ms
  if (docSize > 20000) return 300;    // 20K+: 300ms
  return 100;                          // Default: 100ms (using RAF for small docs)
}

/**
 * Document-size threshold (in characters) above which content-visibility
 * optimization is enabled. Below this, the cv-idle toggle causes visible
 * layout shift on every keystroke-to-idle transition because `auto`
 * intrinsic-size estimates diverge from real block heights when off-screen
 * blocks have never been rendered. For small docs the optimization delivers
 * no measurable win and the toggle produces a "shaking" / rippling effect
 * as the total document height changes on each idle interval (#823).
 */
export const CV_IDLE_CHAR_THRESHOLD = 50_000;

/**
 * Suppress content-visibility during active typing — keeping cv on during
 * edits costs O(blocks-after-insertion)/keystroke (378ms on a 2250-block
 * doc). Re-enables after 500ms idle so scroll/repaint keep the optimization.
 *
 * Small documents (<CV_IDLE_CHAR_THRESHOLD) skip the re-enable entirely:
 * the toggle causes visible shaking because `contain-intrinsic-size: auto`
 * fallbacks don't match real block heights when off-screen blocks have
 * never been rendered, and small docs don't need the optimization anyway (#823).
 */
export function suppressCvIdleDuringEdit(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  docSize: number,
  cvIdleTimeoutRef: MutableRefObject<number | null>,
): void {
  const container = containerRef.current;
  if (!container) return;
  container.classList.remove("cv-idle");
  if (cvIdleTimeoutRef.current !== null) {
    window.clearTimeout(cvIdleTimeoutRef.current);
    cvIdleTimeoutRef.current = null;
  }
  if (docSize >= CV_IDLE_CHAR_THRESHOLD) {
    cvIdleTimeoutRef.current = window.setTimeout(() => {
      cvIdleTimeoutRef.current = null;
      containerRef.current?.classList.add("cv-idle");
    }, 500);
  }
}

/**
 * Parse markdown and sync it into the editor without touching undo history.
 * Updates lastExternalContent tracking ref on success.
 * Returns true if content was synced, false if already current or on error.
 */
export function syncMarkdownToEditor(
  editor: TiptapEditor,
  markdown: string,
  lastExternalContent: MutableRefObject<string>,
  preserveLineBreaks: boolean,
): boolean {
  if (markdown === lastExternalContent.current) return false;
  try {
    const doc = parseMarkdown(editor.schema, markdown, { preserveLineBreaks });
    setContentWithoutHistory(editor, doc);
    lastExternalContent.current = markdown;
    return true;
  } catch (error) {
    tiptapError(" Failed to sync markdown:", error);
    return false;
  }
}
