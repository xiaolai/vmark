/**
 * Media Popup Tiptap Extension
 *
 * Purpose: Registers the MediaPopupView as a ProseMirror plugin view, connecting
 * the store-driven media popup to the editor lifecycle.
 *
 * @coordinates-with MediaPopupView.ts — DOM construction and behavior for the media popup
 * @coordinates-with plugins/shared/popupPorts.ts — the state PORT the host satisfies
 * @module plugins/mediaPopup/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { StoreApi } from "zustand";
import type { MediaPopupState } from "@/plugins/shared/popupPorts";
import { MediaPopupView } from "./MediaPopupView";

const mediaPopupPluginKey = new PluginKey("mediaPopup");

class MediaPopupPluginView {
  private popupView: MediaPopupView;

  constructor(view: EditorView, store: StoreApi<MediaPopupState>) {
    this.popupView = new MediaPopupView(view, store);
  }

  update() {
    // No-op — popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

/** Tiptap extension that shows a popup when the cursor is on an audio/video node. */
export interface MediaPopupOptions {
  /** The popup state this plugin drives — a PORT, no default (ADR-015). */
  store: StoreApi<MediaPopupState>;
}

export const mediaPopupExtension = Extension.create<MediaPopupOptions>({
  name: "mediaPopup",
  addOptions() {
    return { store: undefined as unknown as StoreApi<MediaPopupState> };
  },
  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) {
      throw new Error(
        "mediaPopupExtension requires a `store` option — see services/assembly/tiptapExtensions.ts"
      );
    }
    return [
      new Plugin({
        key: mediaPopupPluginKey,
        view: (editorView) => new MediaPopupPluginView(editorView, store),
      }),
    ];
  },
});
