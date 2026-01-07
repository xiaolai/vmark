import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentId } from "@/hooks/useDocumentState";
import { SourceEditor } from "./SourceEditor";
import { TiptapEditorInner } from "./TiptapEditor";
import "./editor.css";
import "./source-peek.css";
import "@/plugins/cursorAware/cursor-aware.css";
import "@/plugins/linkPopup/link-popup.css";
import "@/plugins/imagePopup/image-popup.css";
import "@/plugins/alertBlock/alert-block.css";
import "@/plugins/detailsBlock/details-block.css";
import "@/plugins/focusMode/focus-mode.css";
import "@/plugins/typewriterMode/typewriter-mode.css";
import "@/plugins/search/search.css";
import "@/plugins/codePreview/code-preview.css";
import "@/plugins/latex/latex.css";
import "@/plugins/mermaid/mermaid.css";
import "@/plugins/tableUI/table-ui.css";
import "@/plugins/subSuperscript/sub-super.css";
import "@/plugins/highlight/highlight.css";
import "@/plugins/formatToolbar/format-toolbar.css";
import "katex/dist/katex.min.css";

export function Editor() {
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const documentId = useDocumentId();
  const mediaBorderStyle = useSettingsStore((s) => s.markdown.mediaBorderStyle);

  const editorKey = `doc-${documentId}`;
  const containerClass = `editor-container media-border-${mediaBorderStyle}`;

  return (
    <div className={containerClass}>
      <div className="editor-content">
        {sourceMode ? <SourceEditor key={editorKey} /> : <TiptapEditorInner key={editorKey} />}
      </div>
    </div>
  );
}

export default Editor;
