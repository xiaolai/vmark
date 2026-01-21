import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
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
import { smartPasteExtension } from "@/plugins/smartPaste/tiptap";
import { markdownPasteExtension } from "@/plugins/markdownPaste/tiptap";
import { linkPopupExtension } from "@/plugins/linkPopup/tiptap";
import { inlineNodeEditingExtension } from "@/plugins/inlineNodeEditing/tiptap";
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
import { floatingMathPreviewExtension } from "@/plugins/codePreview/floatingMathPreview";
import { blockMathKeymapExtension } from "@/plugins/codePreview/blockMathKeymap";
import { listContinuationExtension } from "@/plugins/listContinuation/tiptap";
import { tableUIExtension } from "@/plugins/tableUI/tiptap";
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
import { AlignedTableCell, AlignedTableHeader } from "@/components/Editor/alignedTableNodes";
import {
  frontmatterExtension,
  htmlBlockExtension,
  htmlInlineExtension,
  linkDefinitionExtension,
  wikiLinkExtension,
} from "@/plugins/markdownArtifacts";
import { wikiLinkPopupExtension } from "@/plugins/wikiLinkPopup";
import { htmlBlockPopupExtension } from "@/plugins/htmlBlockPopup";

/**
 * Creates the array of Tiptap extensions for the WYSIWYG editor.
 * This is a pure factory function with no React dependencies.
 */
export function createTiptapExtensions(): Extensions {
  return [
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
    linkDefinitionExtension,
    frontmatterExtension,
    htmlInlineExtension,
    htmlBlockExtension,
    wikiLinkPopupExtension,
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
    inlineNodeEditingExtension,
    footnotePopupExtension,
    smartPasteExtension,
    markdownPasteExtension,
    linkPopupExtension,
    searchExtension,
    spellCheckExtension,
    autoPairExtension,
    focusModeExtension,
    typewriterModeExtension,
    imageHandlerExtension,
    imagePopupExtension,
    codePreviewExtension,
    floatingMathPreviewExtension,
    blockMathKeymapExtension,
    listContinuationExtension,
    editorKeymapExtension,
    tabIndentExtension,
    multiCursorExtension,
  ];
}
