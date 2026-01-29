import { useViewSettingsStore } from "@/stores/viewSettingsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useActiveTabId, useDocumentId } from "@/hooks/useDocumentState";
import { useUnifiedMenuCommands } from "@/hooks/useUnifiedMenuCommands";
import { SourceEditor } from "./SourceEditor";
import { TiptapEditorInner } from "./TiptapEditor";
import { HeadingPicker } from "./HeadingPicker";
import { DropZoneIndicator } from "./DropZoneIndicator";
import "./editor.css";
import "./heading-picker.css";
import "./source-peek.css";
import "@/plugins/linkPopup/link-popup.css";
import "@/plugins/imagePopup/image-popup.css";
import "@/plugins/sourceImagePopup/source-image-popup.css";
import "@/plugins/sourceLinkPopup/source-link-popup.css";
import "@/plugins/sourceWikiLinkPopup/source-wiki-link-popup.css";
import "@/plugins/sourceFootnotePopup/source-footnote-popup.css";
import "@/plugins/mathPopup/math-popup.css";
import "@/plugins/wikiLinkPopup/wiki-link-popup.css";
import "@/plugins/footnotePopup/footnote-popup.css";
import "@/styles/popup-shared.css";
import "@/plugins/alertBlock/alert-block.css";
import "@/plugins/detailsBlock/details-block.css";
import "@/plugins/focusMode/focus-mode.css";
import "@/plugins/typewriterMode/typewriter-mode.css";
import "@/plugins/search/search.css";
import "@/plugins/aiSuggestion/ai-suggestion.css";
import "@/plugins/codePreview/code-preview.css";
import "@/plugins/latex/latex.css";
import "@/plugins/mathPreview/math-preview.css";
import "@/plugins/mermaid/mermaid.css";
import "@/plugins/tableUI/table-ui.css";
import "@/plugins/subSuperscript/sub-super.css";
import "@/plugins/highlight/highlight.css";
import "@/plugins/underline/underline.css";
import "@/plugins/markdownArtifacts/markdown-artifacts.css";
import "@/plugins/imagePasteToast/image-paste-toast.css";
import "@/plugins/cjkLetterSpacing/cjk-letter-spacing.css";
import "katex/dist/katex.min.css";

export function Editor() {
  const sourceMode = useViewSettingsStore((state) => state.sourceMode);
  const tabId = useActiveTabId();
  const documentId = useDocumentId();
  const mediaBorderStyle = useSettingsStore((s) => s.markdown.mediaBorderStyle);
  const mediaAlignment = useSettingsStore((s) => s.markdown.mediaAlignment);
  const headingAlignment = useSettingsStore((s) => s.markdown.headingAlignment);
  const blockFontSize = useSettingsStore((s) => s.markdown.blockFontSize);
  const htmlRenderingMode = useSettingsStore((s) => s.markdown.htmlRenderingMode);

  // Mount unified menu dispatcher (handles routing based on mode)
  useUnifiedMenuCommands();

  // Include tabId in key to ensure editor remounts when switching tabs
  // documentId handles content reloads within the same tab
  const editorKey = `${tabId}-doc-${documentId}`;
  const containerClass = `editor-container media-border-${mediaBorderStyle} media-align-${mediaAlignment} heading-align-${headingAlignment}`;

  return (
    <div
      className={containerClass}
      data-html-rendering-mode={htmlRenderingMode}
      style={{ "--block-font-size": `${blockFontSize}em` } as React.CSSProperties}
    >
      <div className="editor-content">
        {sourceMode ? <SourceEditor key={editorKey} /> : <TiptapEditorInner key={editorKey} />}
      </div>
      <HeadingPicker />
      <DropZoneIndicator />
    </div>
  );
}

export default Editor;
