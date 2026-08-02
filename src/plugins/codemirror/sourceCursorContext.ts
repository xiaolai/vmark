import { EditorView } from "@codemirror/view";
import { hostEditors } from "@/plugins/shared/hostEditors";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";

/** Creates a CodeMirror plugin that updates the source cursor context store on selection changes. */
export function createSourceCursorContextPlugin() {
  return EditorView.updateListener.of((update) => {
    /* v8 ignore next -- @preserve short-circuit branches and else path not all covered in tests */
    if (
      hostEditors.source().editorView !== update.view ||
      update.selectionSet ||
      update.docChanged
    ) {
      hostEditors.reportSourceContext(computeSourceCursorContext(update.view), update.view);
    }
  });
}
