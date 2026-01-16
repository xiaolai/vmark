import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useDocumentActions, useDocumentContent, useDocumentCursorInfo } from "@/hooks/useDocumentState";
import {
  HeadingWithSourceLine,
  ParagraphWithSourceLine,
  CodeBlockWithSourceLine,
  BlockquoteWithSourceLine,
  BulletListWithSourceLine,
  OrderedListWithSourceLine,
  HorizontalRuleWithSourceLine,
  TableWithSourceLine,
  TableRowWithSourceLine,
} from "@/plugins/shared/sourceLineNodes";
import { useImageContextMenu } from "@/hooks/useImageContextMenu";
import { useOutlineSync } from "@/hooks/useOutlineSync";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { registerActiveWysiwygFlusher } from "@/utils/wysiwygFlush";
import { getCursorInfoFromTiptap, restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import { getTiptapEditorView } from "@/utils/tiptapView";
import { scheduleTiptapFocusAndRestore } from "@/utils/tiptapFocus";
import type { CursorInfo } from "@/stores/documentStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useSettingsStore } from "@/stores/settingsStore";
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
import { extractTiptapContext } from "@/plugins/formatToolbar/tiptapContext";
import { editorKeymapExtension } from "@/plugins/editorPlugins.tiptap";
import { highlightExtension } from "@/plugins/highlight/tiptap";
import { subscriptExtension, superscriptExtension } from "@/plugins/subSuperscript/tiptap";
import { underlineExtension } from "@/plugins/underline/tiptap";
import { alertBlockExtension } from "@/plugins/alertBlock/tiptap";
import { detailsBlockExtension, detailsSummaryExtension } from "@/plugins/detailsBlock/tiptap";
import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { mathInlineExtension } from "@/plugins/latex/tiptapInlineMath";
import { mathPopupExtension } from "@/plugins/mathPopup";
import { footnotePopupExtension } from "@/plugins/footnotePopup/tiptap";
import { footnoteDefinitionExtension, footnoteReferenceExtension } from "@/plugins/footnotePopup/tiptapNodes";
import { slashMenuExtension } from "@/plugins/triggerMenu/tiptapSlashMenu";
import { tabIndentExtension } from "@/plugins/tabIndent/tiptap";
import { multiCursorExtension } from "@/plugins/multiCursor/tiptap";
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
import { wikiLinkPopupExtension } from "@/plugins/wikiLinkPopup";
import { wikiEmbedPopupExtension } from "@/plugins/wikiEmbedPopup";
import { htmlBlockPopupExtension } from "@/plugins/htmlBlockPopup";

/**
 * Delay before enabling cursor tracking after editor creation.
 * Prevents spurious cursor sync during initial render/focus.
 */
const CURSOR_TRACKING_DELAY_MS = 200;


export function TiptapEditorInner() {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo } = useDocumentActions();
  const preserveLineBreaks = useSettingsStore((state) => state.markdown.preserveLineBreaks);

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);
  const pendingCursorRaf = useRef<number | null>(null);
  const internalChangeRaf = useRef<number | null>(null);
  const pendingCursorInfo = useRef<CursorInfo | null>(null);
  const cursorTrackingEnabled = useRef(false);
  const trackingTimeoutId = useRef<number | null>(null);
  const cursorInfoRef = useRef(cursorInfo);
  const preserveLineBreaksRef = useRef(preserveLineBreaks);
  cursorInfoRef.current = cursorInfo;
  preserveLineBreaksRef.current = preserveLineBreaks;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // We parse/serialize markdown ourselves.
        // Keep Tiptap defaults for schema names and commands.
        listItem: false,
        underline: false,
        // Disable nodes replaced with sourceLine-enabled versions
        heading: false,
        paragraph: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false,
        // Disable default link click behavior - we handle it via linkPopupExtension
        link: {
          openOnClick: false,
          // Don't add target="_blank" - it bypasses our click handling
          HTMLAttributes: {
            target: null,
            rel: null,
          },
        },
      }),
      // Extended nodes with sourceLine attribute for cursor sync
      HeadingWithSourceLine,
      ParagraphWithSourceLine,
      CodeBlockWithSourceLine,
      BlockquoteWithSourceLine,
      BulletListWithSourceLine,
      OrderedListWithSourceLine,
      HorizontalRuleWithSourceLine,
      slashMenuExtension,
      taskListItemExtension,
      highlightExtension,
      subscriptExtension,
      superscriptExtension,
      underlineExtension,
      mathInlineExtension,
      mathPopupExtension,
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
      wikiLinkPopupExtension,
      wikiEmbedPopupExtension,
      htmlBlockPopupExtension,
      footnoteReferenceExtension,
      footnoteDefinitionExtension,
      TableWithSourceLine.configure({ resizable: false }),
      TableRowWithSourceLine,
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
      editorKeymapExtension,
      tabIndentExtension,
      multiCursorExtension,
    ],
    []
  );

  const flushToStore = useCallback(
    (editor: TiptapEditor) => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }

      const markdown = serializeMarkdown(editor.schema, editor.state.doc, {
        preserveLineBreaks: preserveLineBreaksRef.current,
      });
      isInternalChange.current = true;
      lastExternalContent.current = markdown;
      setContent(markdown);

      // Cancel previous RAF if pending, then schedule reset
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
      }
      internalChangeRaf.current = requestAnimationFrame(() => {
        internalChangeRaf.current = null;
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
        const doc = parseMarkdown(editor.schema, content, {
          preserveLineBreaks: preserveLineBreaksRef.current,
        });
        lastExternalContent.current = content;
        editor.commands.setContent(doc, { emitUpdate: false });
      } catch (error) {
        console.error("[TiptapEditor] Failed to parse initial markdown:", error);
        // Don't update lastExternalContent on parse error - allows retry on next sync
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

      const view = getTiptapEditorView(editor);
      if (view) {
        useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
      }
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
      useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
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

  // Cleanup all pending timers/RAFs on unmount to prevent memory leaks
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
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
        internalChangeRaf.current = null;
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

  useEffect(() => {
    useTiptapEditorStore.getState().setEditor(editor ?? null);
    return () => {
      useTiptapEditorStore.getState().clear();
    };
  }, [editor]);

  // Sync external content changes TO the editor.
  useEffect(() => {
    if (!editor) return;
    if (isInternalChange.current) return;
    if (content === lastExternalContent.current) return;

    try {
      const doc = parseMarkdown(editor.schema, content, {
        preserveLineBreaks: preserveLineBreaksRef.current,
      });
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
