/**
 * Math Popup Tiptap Extension
 *
 * Purpose: Registers the MathPopupView as a ProseMirror plugin view so it mounts
 * and destroys with the editor lifecycle. The popup itself is store-driven —
 * updates come via mathPopupStore subscription, not ProseMirror's `update()` hook.
 *
 * @coordinates-with MathPopupView.ts — the popup DOM and interaction logic
 * @coordinates-with mathPopupStore.ts — open/close/value state
 * @module plugins/mathPopup/tiptap
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { MathPopupView } from "./MathPopupView";

const mathPopupPluginKey = new PluginKey("mathPopup");

class MathPopupPluginView {
  private popupView: MathPopupView;

  constructor(view: EditorView) {
    this.popupView = new MathPopupView(view);
  }

  update() {
    // No-op: popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

export const mathPopupExtension = Extension.create({
  name: "mathPopup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mathPopupPluginKey,
        view: (editorView) => new MathPopupPluginView(editorView),
      }),
    ];
  },
});
