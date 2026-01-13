import { EditorView, ViewPlugin } from "@codemirror/view";
import { flushCodeMirrorCompositionQueue } from "@/utils/imeGuard";

export function createImeGuardPlugin() {
  return ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private handleCompositionEnd = () => {
        requestAnimationFrame(() => {
          flushCodeMirrorCompositionQueue(this.view);
        });
      };

      constructor(view: EditorView) {
        this.view = view;
        this.view.dom.addEventListener("compositionend", this.handleCompositionEnd);
      }

      destroy() {
        this.view.dom.removeEventListener("compositionend", this.handleCompositionEnd);
      }
    }
  );
}
