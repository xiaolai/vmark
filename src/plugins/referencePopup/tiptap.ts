/**
 * Reference Popup Extension
 *
 * Creates and manages the ReferencePopupView for inserting reference links.
 * Unlike other popup extensions, this doesn't detect clicks on nodes -
 * it's triggered from toolbar actions.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReferencePopupView } from "./ReferencePopupView";

const referencePopupPluginKey = new PluginKey("referencePopup");

export const referencePopupExtension = Extension.create({
  name: "referencePopup",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: referencePopupPluginKey,
        view: (view) => {
          const popupView = new ReferencePopupView(view);
          return {
            destroy: () => popupView.destroy(),
          };
        },
      }),
    ];
  },
});
