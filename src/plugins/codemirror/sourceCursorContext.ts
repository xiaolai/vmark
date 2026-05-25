import { EditorView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";

/** Creates a CodeMirror plugin that updates the source cursor context store on selection changes. */
export function createSourceCursorContextPlugin() {
  return EditorView.updateListener.of((update) => {
    const store = useEditorStore.getState();
    /* v8 ignore next -- @preserve short-circuit branches and else path not all covered in tests */
    if (store.source.editorView !== update.view || update.selectionSet || update.docChanged) {
      store.setSourceContext(computeSourceCursorContext(update.view), update.view);
    }
  });
}
