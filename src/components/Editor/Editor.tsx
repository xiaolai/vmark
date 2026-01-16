import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentId } from "@/hooks/useDocumentState";
import { SourceEditor } from "./SourceEditor";
import { TiptapEditorInner } from "./TiptapEditor";
import { HeadingPicker } from "./HeadingPicker";
import { LinkReferenceDialog } from "./LinkReferenceDialog";
import "./editor.css";
import "./heading-picker.css";
import "./link-reference-dialog.css";
import "./source-peek.css";
import "@/plugins/cursorAware/cursor-aware.css";
import "@/plugins/linkPopup/link-popup.css";
import "@/plugins/imagePopup/image-popup.css";
import "@/plugins/mathPopup/math-popup.css";
import "@/plugins/wikiLinkPopup/wiki-link-popup.css";
import "@/plugins/wikiEmbedPopup/wiki-embed-popup.css";
import "@/plugins/htmlBlockPopup/html-popup.css";
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
import "@/plugins/underline/underline.css";
import "@/plugins/markdownArtifacts/markdown-artifacts.css";
import "katex/dist/katex.min.css";

export function Editor() {
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const documentId = useDocumentId();
  const mediaBorderStyle = useSettingsStore((s) => s.markdown.mediaBorderStyle);
  const htmlRenderingMode = useSettingsStore((s) => s.markdown.htmlRenderingMode);
  const revealInlineSyntax = useSettingsStore((s) => s.markdown.revealInlineSyntax);

  const editorKey = `doc-${documentId}`;
  const containerClass = `editor-container media-border-${mediaBorderStyle}`;

  return (
    <div
      className={containerClass}
      data-html-rendering-mode={htmlRenderingMode}
      data-reveal-inline-syntax={revealInlineSyntax ? "true" : "false"}
    >
      <div className="editor-content">
        {sourceMode ? <SourceEditor key={editorKey} /> : <TiptapEditorInner key={editorKey} />}
      </div>
      <HeadingPicker />
      <LinkReferenceDialog />
    </div>
  );
}

export default Editor;
