/**
 * Pre-mode-switch cleanup.
 *
 * Closes stale popups and previews before toggling source/WYSIWYG mode.
 * Called from both the keyboard shortcut path and the menu event path.
 */

import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
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
    const popupStore = useImagePopupStore.getState();
    if (popupStore.isOpen) {
      popupStore.closePopup();
    }
    hideImagePreview();
  } catch {
    // Non-critical cleanup — don't block mode switch
  }
}
