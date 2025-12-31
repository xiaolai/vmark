/**
 * Image Popup Plugin
 *
 * Manages the image popup lifecycle. The actual click handling
 * is done in ImageNodeView - this plugin just creates/destroys
 * the popup view.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, PluginView } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { ImagePopupView } from "./ImagePopupView";

export const imagePopupPluginKey = new PluginKey("imagePopup");

/**
 * Plugin view that manages the ImagePopupView lifecycle.
 */
class ImagePopupPluginView implements PluginView {
  private popupView: ImagePopupView;

  constructor(view: EditorView) {
    this.popupView = new ImagePopupView(view);
  }

  update() {
    // No-op - popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

/**
 * Image popup plugin for Milkdown.
 */
export const imagePopupPlugin = $prose(() => {
  return new Plugin({
    key: imagePopupPluginKey,
    view(editorView) {
      return new ImagePopupPluginView(editorView);
    },
  });
});

export default imagePopupPlugin;
