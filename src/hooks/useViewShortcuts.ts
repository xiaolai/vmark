/**
 * View Shortcuts Hook
 *
 * Handles keyboard shortcuts for view modes (F7, F8, F9).
 * Menu accelerators don't always work reliably, so we listen directly.
 */

import { useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";

export function useViewShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      switch (e.key) {
        case "F7":
          e.preventDefault();
          flushActiveWysiwygNow();
          useEditorStore.getState().toggleSourceMode();
          break;
        case "F8":
          e.preventDefault();
          useEditorStore.getState().toggleFocusMode();
          break;
        case "F9":
          e.preventDefault();
          useEditorStore.getState().toggleTypewriterMode();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
