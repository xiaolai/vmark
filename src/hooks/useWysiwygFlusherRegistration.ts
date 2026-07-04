/**
 * useWysiwygFlusherRegistration
 *
 * Purpose: register the WYSIWYG editor's flush-to-store callback for
 * save/Save-All — only when visible and NOT a preview (a preview must never
 * serialize the read-only WYSIWYG over the source markdown). Extracted
 * verbatim from TiptapEditor.tsx (effect stack split).
 *
 * @coordinates-with components/Editor/TiptapEditor.tsx — sole consumer
 * @coordinates-with utils/wysiwygFlush.ts — flusher registry
 * @module hooks/useWysiwygFlusherRegistration
 */
import { useEffect } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { registerActiveWysiwygFlusher, registerWysiwygFlusher } from "@/utils/wysiwygFlush";

interface WysiwygFlusherRegistrationOptions {
  flushToStore: (editor: TiptapEditor) => void;
  hidden: boolean;
  preview: boolean;
  activeTabId: string | undefined;
}

/** Register save/Save-All flushers for a visible, non-preview WYSIWYG editor. */
export function useWysiwygFlusherRegistration(
  editor: TiptapEditor | null,
  { flushToStore, hidden, preview, activeTabId }: WysiwygFlusherRegistrationOptions,
): void {
  useEffect(() => {
    if (!editor || hidden || preview) return;
    const flush = () => flushToStore(editor);
    registerActiveWysiwygFlusher(flush);
    if (activeTabId) registerWysiwygFlusher(activeTabId, flush);
    return () => {
      registerActiveWysiwygFlusher(null);
      if (activeTabId) registerWysiwygFlusher(activeTabId, null);
    };
  }, [editor, flushToStore, hidden, preview, activeTabId]);
}
