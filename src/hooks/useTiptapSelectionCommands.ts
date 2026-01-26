import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { FEATURE_FLAGS } from "@/stores/featureFlagsStore";
import {
  expandSelectionInView,
  selectBlockInView,
  selectLineInView,
  selectWordInView,
} from "@/plugins/toolbarActions/tiptapSelectionActions";

export function useTiptapSelectionCommands(editor: TiptapEditor | null) {
  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    // Skip legacy listeners when unified dispatcher is enabled
    if (FEATURE_FLAGS.UNIFIED_MENU_DISPATCHER) {
      return;
    }

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
        const editor = editorRef.current;
        if (!editor) return;

        selectWordInView(editor.view);
      });
      if (cancelled) {
        unlistenSelectWord();
        return;
      }
      unlistenRefs.current.push(unlistenSelectWord);

      const unlistenSelectLine = await currentWindow.listen<string>("menu:select-line", (event) => {
        if (event.payload !== windowLabel) return;
        const editor = editorRef.current;
        if (!editor) return;

        selectLineInView(editor.view);
      });
      if (cancelled) {
        unlistenSelectLine();
        return;
      }
      unlistenRefs.current.push(unlistenSelectLine);

      const unlistenSelectBlock = await currentWindow.listen<string>("menu:select-block", (event) => {
        if (event.payload !== windowLabel) return;
        const editor = editorRef.current;
        if (!editor) return;

        selectBlockInView(editor.view);
      });
      if (cancelled) {
        unlistenSelectBlock();
        return;
      }
      unlistenRefs.current.push(unlistenSelectBlock);

      const unlistenExpandSelection = await currentWindow.listen<string>("menu:expand-selection", (event) => {
        if (event.payload !== windowLabel) return;
        const editor = editorRef.current;
        if (!editor) return;

        expandSelectionInView(editor.view);
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
