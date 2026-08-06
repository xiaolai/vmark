/**
 * Link Create Popup Tiptap Extension
 *
 * Registers the link create popup view with the editor.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { StoreApi } from "@/plugins/shared/types";
import { LinkCreatePopupView, type LinkCreatePopupState } from "./LinkCreatePopupView";

const linkCreatePopupPluginKey = new PluginKey("linkCreatePopup");

/** Tiptap extension that shows a popup for creating new links from selected text. */
/** Options for the link-create popup extension. */
export interface LinkCreatePopupOptions {
  /** The popup state this plugin drives — a PORT, not the app's store. */
  store: StoreApi<LinkCreatePopupState>;
}

export const linkCreatePopupExtension = Extension.create<LinkCreatePopupOptions>({
  name: "linkCreatePopup",

  // No default: there is no sensible stand-in for the state a popup drives.
  addOptions() {
    return { store: undefined as unknown as StoreApi<LinkCreatePopupState> };
  },

  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) {
      throw new Error(
        "linkCreatePopupExtension requires a `store` option — see services/assembly/tiptapExtensions.ts"
      );
    }
    return [
      new Plugin({
        key: linkCreatePopupPluginKey,
        view: (view) => {
          // The popup declares its own state PORT; the host supplies a store that
          // satisfies it (ADR-015).
          const popupView = new LinkCreatePopupView(view, store);
          return {
            destroy: () => popupView.destroy(),
          };
        },
      }),
    ];
  },
});
