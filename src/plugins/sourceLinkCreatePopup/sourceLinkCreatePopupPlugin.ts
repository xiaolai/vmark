/**
 * Source Link Create Popup Plugin
 *
 * CodeMirror 6 plugin for creating links in Source mode.
 * Shows a popup with text + URL inputs when no clipboard URL available.
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { StoreApi } from "@/plugins/shared/types";
import {
  SourceLinkCreatePopupView,
  type LinkCreatePopupState,
} from "./SourceLinkCreatePopupView";

/**
 * Create the Source link create popup plugin.
 */
/**
 * @param store - The popup state this plugin drives. A PORT declared by the
 *   view, satisfied by the host — the plugin itself names no app store
 *   (ADR-015).
 */
export function createSourceLinkCreatePopupPlugin(store: StoreApi<LinkCreatePopupState>) {
  return ViewPlugin.fromClass(
    class SourceLinkCreatePopupPluginInstance {
      private popupView: SourceLinkCreatePopupView;

      /* v8 ignore start -- @preserve reason: CodeMirror ViewPlugin lifecycle callbacks only run inside a live CM editor; not instantiated in unit tests */
      constructor(view: EditorView) {
        this.popupView = new SourceLinkCreatePopupView(view, store);
      }

      update(_update: ViewUpdate) {
        // Popup responds to store changes, no update needed here
      }

      destroy() {
        this.popupView.destroy();
      }
      /* v8 ignore stop */
    }
  );
}
