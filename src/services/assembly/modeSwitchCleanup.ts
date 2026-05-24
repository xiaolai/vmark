/**
 * Pre-Mode-Switch Cleanup
 *
 * Purpose: Closes stale popups, previews, and flushes pending state before
 * toggling between source and WYSIWYG mode.
 *
 * Key decisions:
 *   - Wrapped in try/catch so mode switch always proceeds even if DOM is unexpected
 *   - Flushes WYSIWYG state before switch to ensure source mode gets fresh content
 *   - Called from both keyboard shortcut and menu event paths (single source of truth)
 *
 * @coordinates-with wysiwygFlush.ts — flushActiveWysiwygNow ensures content is serialized
 * @coordinates-with editorStore.ts — sourceMode flag controls which editor is active
 * @module utils/modeSwitchCleanup
 */

import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { hideImagePreview } from "@/plugins/imagePreview/ImagePreviewView";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";

export function cleanupBeforeModeSwitch(): void {
  // Close any open image paste toast
  const toastStore = useImagePasteToastStore.getState();
  if (toastStore.isOpen) {
    toastStore.hideToast();
  }

  flushActiveWysiwygNow();

  // Close image popup and preview — wrapped in try/catch so mode switch
  // always proceeds even if DOM state is unexpected.
  try {
    const popupStore = useMediaPopupStore.getState();
    if (popupStore.isOpen) {
      popupStore.closePopup();
    }
    hideImagePreview();
  } catch {
    // Non-critical cleanup — don't block mode switch
  }
}
