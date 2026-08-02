/**
 * Math Popup Tiptap Extension
 *
 * Purpose: Registers the MathPopupView as a ProseMirror plugin view so it mounts
 * and destroys with the editor lifecycle. The popup itself is store-driven —
 * updates come via mathPopupStore subscription, not ProseMirror's `update()` hook.
 *
 * @coordinates-with MathPopupView.ts — the popup DOM and interaction logic
 * @coordinates-with services/assembly/tiptapExtensions.ts — supplies the store
 * @module plugins/mathPopup/tiptap
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { StoreApi } from "zustand";
import { MathPopupView, type MathPopupState } from "./MathPopupView";
import "./math-popup.css";

const mathPopupPluginKey = new PluginKey("mathPopup");

class MathPopupPluginView {
  private popupView: MathPopupView;

  constructor(view: EditorView, store: StoreApi<MathPopupState>) {
    this.popupView = new MathPopupView(view, store);
  }

  update() {
    // No-op: popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

/** Options for the math-popup extension. */
export interface MathPopupOptions {
  /**
   * The popup state this plugin drives.
   *
   * INJECTED as a PORT — `StoreApi<MathPopupState>`, a shape the plugin
   * declares — not the app's concrete store. Importing that store is what
   * stopped this plugin shipping standalone (ADR-015); receiving a store that
   * satisfies its own interface does not.
   */
  store: StoreApi<MathPopupState>;
}

export const mathPopupExtension = Extension.create<MathPopupOptions>({
  name: "mathPopup",
  // No default store: unlike a SETTING, there is no sensible stand-in for
  // "the state this popup drives". A host that forgets to supply one is
  // misconfigured, and saying so beats a `undefined is not an object` from
  // somewhere inside the view.
  addOptions() {
    return { store: undefined as unknown as StoreApi<MathPopupState> };
  },
  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) {
      throw new Error(
        "mathPopupExtension requires a `store` option — see services/assembly/tiptapExtensions.ts"
      );
    }
    return [
      new Plugin({
        key: mathPopupPluginKey,
        view: (editorView) => new MathPopupPluginView(editorView, store),
      }),
    ];
  },
});
