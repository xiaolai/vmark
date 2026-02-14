/**
 * Image Popup Tiptap Extension
 *
 * Purpose: Registers the ImagePopupView as a ProseMirror plugin view, connecting
 * the store-driven image popup to the editor lifecycle (create on mount, destroy on unmount).
 *
 * @coordinates-with ImagePopupView.ts — DOM construction and behavior for the image popup
 * @coordinates-with stores/imagePopupStore.ts — popup state (visibility, position, image data)
 * @module plugins/imagePopup/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ImagePopupView } from "./ImagePopupView";

const imagePopupPluginKey = new PluginKey("imagePopup");

class ImagePopupPluginView {
  private popupView: ImagePopupView;

  constructor(view: EditorView) {
    this.popupView = new ImagePopupView(
      view as unknown as ConstructorParameters<typeof ImagePopupView>[0]
    );
  }

  update() {
    // No-op - popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

export const imagePopupExtension = Extension.create({
  name: "imagePopup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: imagePopupPluginKey,
        view(editorView) {
          return new ImagePopupPluginView(editorView);
        },
      }),
    ];
  },
});

