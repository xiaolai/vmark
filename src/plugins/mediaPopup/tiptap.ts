/**
 * Media Popup Tiptap Extension
 *
 * Purpose: Registers the MediaPopupView as a ProseMirror plugin view, connecting
 * the store-driven media popup to the editor lifecycle.
 *
 * @coordinates-with MediaPopupView.ts — DOM construction and behavior for the media popup
 * @coordinates-with stores/mediaPopupStore.ts — popup state (visibility, position, media data)
 * @module plugins/mediaPopup/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { MediaPopupView } from "./MediaPopupView";

const mediaPopupPluginKey = new PluginKey("mediaPopup");

class MediaPopupPluginView {
  private popupView: MediaPopupView;

  constructor(view: EditorView) {
    this.popupView = new MediaPopupView(view);
  }

  update() {
    // No-op — popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

export const mediaPopupExtension = Extension.create({
  name: "mediaPopup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mediaPopupPluginKey,
        view(editorView) {
          return new MediaPopupPluginView(editorView);
        },
      }),
    ];
  },
});
