/**
 * Tiptap Extensions Configuration
 *
 * Purpose: Assembles the Tiptap extension stack for VMark's WYSIWYG editor —
 * StarterKit overrides, custom marks/nodes, media extensions, and plugin registrations.
 *
 * Key decisions:
 *   - StarterKit is used as base but with several nodes overridden
 *     (heading, paragraph, codeBlock, etc.) to add sourceLine attributes
 *   - Extensions are loaded eagerly (not lazy) since WYSIWYG is the default mode
 *   - Link extension configured with openOnClick:false (we have custom popups)
 *   - Bold/Italic replaced with CJK-aware versions (lookbehind regexes)
 *   - Custom marks (highlight, underline, sub/superscript) registered here
 *   - Media extensions (block_video, block_audio, video_embed) with NodeViews
 *   - Media popup and handler extensions for editing and drag-drop
 *   - Table of contents (tocExtension) for [TOC] inline navigation
 *
 * @coordinates-with sourceEditorExtensions.ts — parallel config for CodeMirror source mode
 * @coordinates-with markdownPipeline/ — schema nodes must match pipeline converters
 * @coordinates-with editorPlugins.tiptap.ts — additional ProseMirror plugins
 * @module utils/tiptapExtensions
 */

import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  HeadingWithSourceLine,
  ParagraphWithSourceLine,
  CodeBlockWithSourceLine,
  BlockquoteWithSourceLine,
  BulletListWithSourceLine,
  OrderedListWithSourceLine,
  HorizontalRuleWithSourceLine,
  TableRowWithSourceLine,
} from "@/plugins/shared/sourceLineNodes";
import { TableWithScrollWrapper } from "@/plugins/tableScroll";
import { tableScrollFreezeExtension } from "@/plugins/tableScroll/scrollFreeze";
import { smartPasteExtension } from "@/plugins/smartPaste/tiptap";
import { markdownPasteExtension } from "@/plugins/markdownPaste/tiptap";
import { htmlPasteExtension } from "@/plugins/htmlPaste/tiptap";
import { codePasteExtension } from "@/plugins/codePaste/tiptap";
import { markdownCopyExtension } from "@/plugins/markdownCopy/tiptap";
import { linkPopupExtension } from "@/plugins/linkPopup/tiptap";
import { linkCreatePopupExtension } from "@/plugins/linkCreatePopup";
import { inlineNodeEditingExtension } from "@/plugins/inlineNodeEditing/tiptap";
import { searchExtension } from "@/plugins/search/tiptap";
import { autoPairExtension } from "@/plugins/autoPair/tiptap";
import { compositionGuardExtension } from "@/plugins/compositionGuard/tiptap";
import { focusModeExtension } from "@/plugins/focusMode/tiptap";
import { typewriterModeExtension } from "@/plugins/typewriterMode/tiptap";
import { imageViewExtension } from "@/plugins/imageView/tiptap";
import { blockImageExtension } from "@/plugins/blockImage/tiptap";
import { blockVideoExtension } from "@/plugins/blockVideo/tiptap";
import { blockAudioExtension } from "@/plugins/blockAudio/tiptap";
import { videoEmbedExtension } from "@/plugins/videoEmbed/tiptap";
import { mediaPopupExtension } from "@/plugins/mediaPopup/tiptap";
import { mediaHandlerExtension } from "@/plugins/mediaHandler/tiptap";
import { imageHandlerExtension } from "@/plugins/imageHandler/tiptap";
import { codePreviewExtension } from "@/plugins/codePreview/tiptap";
import { blockMathKeymapExtension } from "@/plugins/codePreview/blockMathKeymap";
import { listContinuationExtension } from "@/plugins/listContinuation/tiptap";
import { listBackspaceExtension } from "@/plugins/listBackspace/tiptap";
import { listClickFixExtension } from "@/plugins/listClickFix/tiptap";
import { tableUIExtension } from "@/plugins/tableUI/tiptap";
import { blockEscapeExtension } from "@/plugins/blockEscape";
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
import { tabIndentExtension } from "@/plugins/tabIndent/tiptap";
import { multiCursorExtension } from "@/plugins/multiCursor/tiptap";
import { aiSuggestionExtension } from "@/plugins/aiSuggestion/tiptap";
import { AlignedTableCell, AlignedTableHeader } from "@/components/Editor/alignedTableNodes";
import {
  frontmatterExtension,
  htmlBlockExtension,
  htmlInlineExtension,
  linkDefinitionExtension,
  wikiLinkExtension,
} from "@/plugins/markdownArtifacts";
import { wikiLinkPopupExtension } from "@/plugins/wikiLinkPopup";
import { CJKLetterSpacing } from "@/plugins/cjkLetterSpacing";
import { sourcePeekInlineExtension } from "@/plugins/sourcePeekInline";
import { smartSelectAllExtension } from "@/plugins/smartSelectAll/tiptap";
import { inlineCodeBoundaryExtension } from "@/plugins/inlineCodeBoundary/tiptap";
import { CJKBold, CJKItalic } from "@/plugins/markInputRules/tiptap";
import { textDragDropExtension } from "@/plugins/textDragDrop/tiptap";
import { tocExtension } from "@/plugins/tableOfContents/tiptap";
import { LintExtension } from "@/plugins/lint/tiptap";

export interface TiptapExtensionConfig {
  /** Tab ID for lint diagnostics (required when lintEnabled is true) */
  tabId?: string;
  /** Whether to enable the markdown lint extension */
  lintEnabled?: boolean;
}

/**
 * Creates the array of Tiptap extensions for the WYSIWYG editor.
 * This is a pure factory function with no React dependencies.
 */
export function createTiptapExtensions(config: TiptapExtensionConfig = {}): Extensions {
  const { tabId, lintEnabled } = config;
  return [
    StarterKit.configure({
      // We parse/serialize markdown ourselves.
      // Keep Tiptap defaults for schema names and commands.
      listItem: false,
      underline: false,
      // Disable bold/italic — replaced with CJK-aware versions below
      bold: false,
      italic: false,
      // Disable nodes replaced with sourceLine-enabled versions
      heading: false,
      paragraph: false,
      codeBlock: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      horizontalRule: false,
      // Disable StarterKit's link - we use a custom configured one below
      link: false,
      // Configure undo/redo with increased depth for larger documents
      undoRedo: {
        // Increase depth for larger documents (default is 100)
        depth: 200,
        // Group changes within 500ms into single undo step (default)
        newGroupDelay: 500,
      },
    }),
    // Custom Link extension with excludes to prevent nested links and code inside links
    Link.extend({
      excludes: "link code",
    }).configure({
      openOnClick: false,
      // Don't add target="_blank" - it bypasses our click handling
      HTMLAttributes: {
        target: null,
        rel: null,
      },
    }),
    // CJK-aware bold/italic (replaces StarterKit defaults)
    CJKBold,
    CJKItalic,
    // Extended nodes with sourceLine attribute for cursor sync
    HeadingWithSourceLine,
    ParagraphWithSourceLine,
    CodeBlockWithSourceLine,
    BlockquoteWithSourceLine,
    BulletListWithSourceLine,
    OrderedListWithSourceLine,
    HorizontalRuleWithSourceLine,
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
    tocExtension,
    wikiLinkExtension,
    linkDefinitionExtension,
    frontmatterExtension,
    htmlInlineExtension,
    htmlBlockExtension,
    wikiLinkPopupExtension,
    footnoteReferenceExtension,
    footnoteDefinitionExtension,
    TableWithScrollWrapper.configure({ resizable: false }),
    TableRowWithSourceLine,
    AlignedTableHeader,
    AlignedTableCell,
    tableUIExtension,
    tableScrollFreezeExtension,
    blockEscapeExtension,
    compositionGuardExtension,
    blockImageExtension,
    blockVideoExtension,
    blockAudioExtension,
    videoEmbedExtension,
    imageViewExtension,
    inlineNodeEditingExtension,
    footnotePopupExtension,
    smartPasteExtension,
    markdownPasteExtension,
    htmlPasteExtension,
    codePasteExtension,
    markdownCopyExtension,
    linkPopupExtension,
    linkCreatePopupExtension,
    searchExtension,
    autoPairExtension,
    focusModeExtension,
    typewriterModeExtension,
    imageHandlerExtension,
    mediaHandlerExtension,
    mediaPopupExtension,
    codePreviewExtension,
    blockMathKeymapExtension,
    listContinuationExtension,
    listBackspaceExtension,
    listClickFixExtension,
    // Note: ListKeymap (backspace, arrow keys in list items) is included via StarterKit
    editorKeymapExtension,
    tabIndentExtension,
    multiCursorExtension,
    aiSuggestionExtension,
    CJKLetterSpacing,
    sourcePeekInlineExtension,
    smartSelectAllExtension,
    inlineCodeBoundaryExtension,
    textDragDropExtension,
    // Lint decorations (block-level, WYSIWYG only)
    ...(lintEnabled && tabId
      ? [LintExtension.configure({ tabId })]
      : []),
  ];
}
