import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow } from "@tiptap/extension-table";
import { useDocumentActions, useDocumentContent, useDocumentCursorInfo } from "@/hooks/useDocumentState";
import { useImageContextMenu } from "@/hooks/useImageContextMenu";
import { useOutlineSync } from "@/hooks/useOutlineSync";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { registerActiveWysiwygFlusher } from "@/utils/wysiwygFlush";
import { getCursorInfoFromTiptap, restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import { getTiptapEditorView } from "@/utils/tiptapView";
import { scheduleTiptapFocusAndRestore } from "@/utils/tiptapFocus";
import type { CursorInfo } from "@/stores/documentStore";
import { smartPasteExtension } from "@/plugins/smartPaste/tiptap";
import { linkPopupExtension } from "@/plugins/linkPopup/tiptap";
import { cursorAwareExtension } from "@/plugins/cursorAware/tiptap";
import { searchExtension } from "@/plugins/search/tiptap";
import { spellCheckExtension } from "@/plugins/spellCheck/tiptap";
import { autoPairExtension } from "@/plugins/autoPair/tiptap";
import { compositionGuardExtension } from "@/plugins/compositionGuard/tiptap";
import { focusModeExtension } from "@/plugins/focusMode/tiptap";
import { typewriterModeExtension } from "@/plugins/typewriterMode/tiptap";
import { imageViewExtension } from "@/plugins/imageView/tiptap";
import { blockImageExtension } from "@/plugins/blockImage/tiptap";
import { imagePopupExtension } from "@/plugins/imagePopup/tiptap";
import { imageHandlerExtension } from "@/plugins/imageHandler/tiptap";
import { codePreviewExtension } from "@/plugins/codePreview/tiptap";
import { listContinuationExtension } from "@/plugins/listContinuation/tiptap";
import { tableUIExtension } from "@/plugins/tableUI/tiptap";
import { formatToolbarExtension } from "@/plugins/formatToolbar/tiptap";
import { editorKeymapExtension } from "@/plugins/editorPlugins.tiptap";
import { highlightExtension } from "@/plugins/highlight/tiptap";
import { subscriptExtension, superscriptExtension } from "@/plugins/subSuperscript/tiptap";
import { underlineExtension } from "@/plugins/underline/tiptap";
import { alertBlockExtension } from "@/plugins/alertBlock/tiptap";
import { detailsBlockExtension, detailsSummaryExtension } from "@/plugins/detailsBlock/tiptap";
import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { mathInlineExtension } from "@/plugins/latex/tiptapInlineMath";
import { footnotePopupExtension } from "@/plugins/footnotePopup/tiptap";
import { footnoteDefinitionExtension, footnoteReferenceExtension } from "@/plugins/footnotePopup/tiptapNodes";
import { slashMenuExtension } from "@/plugins/triggerMenu/tiptapSlashMenu";
import { tabIndentExtension } from "@/plugins/tabIndent/tiptap";
import { useTiptapCJKFormatCommands } from "@/hooks/useTiptapCJKFormatCommands";
import { useTiptapFormatCommands } from "@/hooks/useTiptapFormatCommands";
import { useTiptapParagraphCommands } from "@/hooks/useTiptapParagraphCommands";
import { useTiptapSelectionCommands } from "@/hooks/useTiptapSelectionCommands";
import { useTiptapTableCommands } from "@/hooks/useTiptapTableCommands";
import { ImageContextMenu } from "./ImageContextMenu";
import { SourcePeek } from "./SourcePeek";
import { AlignedTableCell, AlignedTableHeader } from "./alignedTableNodes";
import {
  frontmatterExtension,
  htmlBlockExtension,
  htmlInlineExtension,
  linkDefinitionExtension,
  linkReferenceExtension,
  wikiEmbedExtension,
  wikiLinkExtension,
} from "@/plugins/markdownArtifacts";

const CURSOR_TRACKING_DELAY_MS = 200;


export function TiptapEditorInner() {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo } = useDocumentActions();

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);
  const pendingCursorRaf = useRef<number | null>(null);
  const pendingCursorInfo = useRef<CursorInfo | null>(null);
  const cursorTrackingEnabled = useRef(false);
  const trackingTimeoutId = useRef<number | null>(null);
  const cursorInfoRef = useRef(cursorInfo);
  cursorInfoRef.current = cursorInfo;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // We parse/serialize markdown ourselves.
        // Keep Tiptap defaults for schema names and commands.
        listItem: false,
        underline: false,
      }),
      slashMenuExtension,
      taskListItemExtension,
      highlightExtension,
      subscriptExtension,
      superscriptExtension,
      underlineExtension,
      mathInlineExtension,
      alertBlockExtension,
      detailsSummaryExtension,
      detailsBlockExtension,
      wikiLinkExtension,
      wikiEmbedExtension,
      linkReferenceExtension,
      linkDefinitionExtension,
      frontmatterExtension,
      htmlInlineExtension,
      htmlBlockExtension,
      footnoteReferenceExtension,
      footnoteDefinitionExtension,
      Table.configure({ resizable: false }),
      TableRow,
      AlignedTableHeader,
      AlignedTableCell,
      tableUIExtension,
      compositionGuardExtension,
      blockImageExtension,
      imageViewExtension,
      cursorAwareExtension,
      footnotePopupExtension,
      smartPasteExtension,
      linkPopupExtension,
      searchExtension,
      spellCheckExtension,
      autoPairExtension,
      focusModeExtension,
      typewriterModeExtension,
      imageHandlerExtension,
      imagePopupExtension,
      codePreviewExtension,
      listContinuationExtension,
      formatToolbarExtension,
      editorKeymapExtension,
      tabIndentExtension,
    ],
    []
  );

  const flushToStore = useCallback(
    (editor: TiptapEditor) => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }

      const markdown = serializeMarkdown(editor.schema, editor.state.doc);
      isInternalChange.current = true;
      lastExternalContent.current = markdown;
      setContent(markdown);
      requestAnimationFrame(() => {
        isInternalChange.current = false;
      });
    },
    [setContent]
  );

  const flushCursorInfo = useCallback(() => {
    pendingCursorRaf.current = null;
    if (!pendingCursorInfo.current) return;
    setCursorInfo(pendingCursorInfo.current);
    pendingCursorInfo.current = null;
  }, [setCursorInfo]);

  const scheduleCursorUpdate = useCallback(
    (info: CursorInfo) => {
      pendingCursorInfo.current = info;
      if (pendingCursorRaf.current === null) {
        pendingCursorRaf.current = requestAnimationFrame(flushCursorInfo);
      }
    },
    [flushCursorInfo]
  );

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: "ProseMirror",
      },
    },
    onCreate: ({ editor }) => {
      try {
        const doc = parseMarkdown(editor.schema, content);
        lastExternalContent.current = content;
        editor.commands.setContent(doc, { emitUpdate: false });
      } catch (error) {
        console.error("[TiptapEditor] Failed to parse initial markdown:", error);
        lastExternalContent.current = content;
      }

      cursorTrackingEnabled.current = false;
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
      }
      trackingTimeoutId.current = window.setTimeout(() => {
        cursorTrackingEnabled.current = true;
      }, CURSOR_TRACKING_DELAY_MS);

      registerActiveWysiwygFlusher(() => flushToStore(editor));
      scheduleTiptapFocusAndRestore(
        editor,
        () => cursorInfoRef.current,
        restoreCursorInTiptap
      );
    },
    onUpdate: ({ editor }) => {
      if (pendingRaf.current) return;
      pendingRaf.current = requestAnimationFrame(() => {
        pendingRaf.current = null;
        flushToStore(editor);
      });
    },
    onSelectionUpdate: ({ editor }) => {
      if (!cursorTrackingEnabled.current) return;
      const view = getTiptapEditorView(editor);
      if (!view) return;
      scheduleCursorUpdate(getCursorInfoFromTiptap(view));
    },
  });

  const getEditorView = useCallback(() => getTiptapEditorView(editor), [editor]);
  const handleImageContextMenuAction = useImageContextMenu(getEditorView);
  useOutlineSync(getEditorView);

  useTiptapParagraphCommands(editor);
  useTiptapFormatCommands(editor);
  useTiptapTableCommands(editor);
  useTiptapSelectionCommands(editor);
  useTiptapCJKFormatCommands(editor);

  // Cleanup pendingRaf on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingCursorRaf.current) {
        cancelAnimationFrame(pendingCursorRaf.current);
        pendingCursorRaf.current = null;
      }
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
        trackingTimeoutId.current = null;
      }
    };
  }, []);

  // Ensure we don't keep a stale flusher if the editor is destroyed/recreated.
  useEffect(() => {
    if (!editor) return;
    registerActiveWysiwygFlusher(() => flushToStore(editor));
    return () => {
      registerActiveWysiwygFlusher(null);
    };
  }, [editor, flushToStore]);

  // Sync external content changes TO the editor.
  useEffect(() => {
    if (!editor) return;
    if (isInternalChange.current) return;
    if (content === lastExternalContent.current) return;

    try {
      const doc = parseMarkdown(editor.schema, content);
      editor.commands.setContent(doc, { emitUpdate: false });
      // Only update lastExternalContent after successful parse to allow retry on failure
      lastExternalContent.current = content;
    } catch (error) {
      console.error("[TiptapEditor] Failed to parse external markdown:", error);
    }
  }, [content, editor]);

  return (
    <>
      <div className="tiptap-editor">
        <EditorContent editor={editor} />
      </div>
      <ImageContextMenu onAction={handleImageContextMenuAction} />
      <SourcePeek getEditorView={getEditorView} />
    </>
  );
}
