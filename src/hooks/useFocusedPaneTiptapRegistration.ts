/**
 * useFocusedPaneTiptapRegistration — register the WYSIWYG editor into the
 * editorStore singleton only when it's visible, not a preview, and the focused
 * pane (#1081). Re-runs when split focus moves; clears on unmount/unfocus.
 * No-op clobbering in single-pane (always focused). Extracted from TiptapEditor
 * to keep that file lean.
 *
 * @coordinates-with stores/editorStore.ts — active WYSIWYG editor
 * @coordinates-with hooks/useIsFocusedPane.ts — focus resolution
 * @module hooks/useFocusedPaneTiptapRegistration
 */
import { useEffect } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useIsFocusedPane } from "@/hooks/useIsFocusedPane";
import { useEditorStore } from "@/stores/editorStore";

export function useFocusedPaneTiptapRegistration(
  editor: TiptapEditor | null,
  opts: { hidden: boolean; preview: boolean; activeTabId: string | undefined; windowLabel: string },
): void {
  const { hidden, preview, activeTabId, windowLabel } = opts;
  const isFocusedPane = useIsFocusedPane(windowLabel);

  useEffect(() => {
    if (!hidden && !preview && isFocusedPane) {
      useEditorStore.getState().setTiptapEditor(editor ?? null);
      if (editor) {
        useEditorStore.getState().setActiveWysiwygEditor(editor, activeTabId);
      }
    }
    return () => {
      // A null-editor instance registered nothing identifiable, so it has
      // nothing to clear — a blanket clearTiptap() here would null whichever
      // pane currently owns the singleton. Identity-guarded for the real case
      // so a focus switch (both panes' cleanups run) can't null the winner.
      if (preview || !editor) return;
      useEditorStore.getState().clearTiptapIfMatch(editor);
      useEditorStore.getState().clearWysiwygEditorIfMatch(editor);
    };
  }, [editor, hidden, preview, activeTabId, isFocusedPane]);
}
