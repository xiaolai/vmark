/**
 * Image Paste Toast Hook
 *
 * Purpose: Initializes the image paste toast UI at app startup — the toast
 *   shows a preview when pasting an image from clipboard into the editor.
 *
 * @coordinates-with imagePasteToast plugin — provides init/destroy lifecycle
 * @coordinates-with imagePasteToastStore.ts — state for the toast UI
 * @module hooks/useImagePasteToast
 */

import { useEffect } from "react";
import { initImagePasteToast, destroyImagePasteToast } from "@/plugins/imagePasteToast";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";

/**
 * Initialize the image paste toast view.
 * Call once in the main layout component.
 */
export function useImagePasteToast(): void {
  useEffect(() => {
    // The toast declares its own state PORT; the app supplies the store that
    // satisfies it (ADR-015).
    initImagePasteToast(useImagePasteToastStore);
    return () => {
      destroyImagePasteToast();
    };
  }, []);
}
