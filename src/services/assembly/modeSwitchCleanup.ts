/**
 * Pre-Mode-Switch Cleanup
 *
 * Purpose: Closes stale popups, previews, and flushes pending state before
 * toggling between source and WYSIWYG mode.
 *
 * Key decisions:
 *   - Every registered popup closes through ONE uniform per-store API
 *     (WI-9, plan-20260803-161713): `setState(getInitialState())` on the
 *     standalone Zustand store — native semantics, no per-popup close-action
 *     spelling. Registering a new popup for mode-switch cleanup is one
 *     `resetIfOpen(useXStore)` line.
 *   - Wrapped in try/catch so mode switch always proceeds even if DOM is unexpected
 *   - Flushes WYSIWYG state before switch to ensure source mode gets fresh content
 *   - Called from both keyboard shortcut and menu event paths (single source of truth)
 *
 * @coordinates-with wysiwygFlush.ts — flushActiveWysiwygNow ensures content is serialized
 * @coordinates-with editorStore.ts — sourceMode flag controls which editor is active
 * @module utils/modeSwitchCleanup
 */

import { useEditorContextMenuStore } from "@/stores/editorContextMenuStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { hideImagePreview } from "@/plugins/imagePreview/ImagePreviewView";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";

/**
 * The one uniform per-store close: reset an open popup store to its initial
 * state via native Zustand semantics. No-op (and no subscriber wake) when the
 * popup is already closed — idempotent by construction.
 */
function resetIfOpen<S extends { isOpen: boolean }>(store: {
  getState: () => S;
  getInitialState: () => S;
  setState: (partial: Partial<S>) => void;
}): void {
  if (store.getState().isOpen) store.setState(store.getInitialState());
}

export function cleanupBeforeModeSwitch(): void {
  // Close any open image paste toast. `resetIfOpen` matches the legacy
  // `hideToast` exactly: reset without invoking onConfirm/onDismiss.
  resetIfOpen(useImagePasteToastStore);

  // Close the editor context menu — its snapshot targets the surface that
  // is about to unmount; activating it after the switch would dispatch
  // against the wrong (or a dead) editor.
  resetIfOpen(useEditorContextMenuStore);

  flushActiveWysiwygNow();

  // Close media popup and image preview — wrapped in try/catch so mode
  // switch always proceeds even if DOM state is unexpected.
  try {
    resetIfOpen(useMediaPopupStore);
    hideImagePreview();
  } catch {
    // Non-critical cleanup — don't block mode switch
  }
}
