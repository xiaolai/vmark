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
import { highlightExtension } from "@/plugins/highlight/tiptap";
import { subscriptExtension, superscriptExtension } from "@/plugins/subSuperscript/tiptap";
import { underlineExtension } from "@/plugins/underline/tiptap";
import { alertBlockExtension } from "@/plugins/alertBlock/tiptap";
import { detailsBlockExtension, detailsSummaryExtension } from "@/plugins/detailsBlock/tiptap";
import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { mathInlineExtension } from "@/plugins/latex/tiptapInlineMath";
import { footnoteDefinitionExtension, footnoteReferenceExtension } from "@/plugins/footnotePopup/tiptapNodes";
import { AlignedTableCell, AlignedTableHeader } from "@/components/Editor/alignedTableNodes";
import {
  frontmatterExtension,
  htmlBlockExtension,
  htmlInlineExtension,
  linkDefinitionExtension,
  wikiLinkExtension,
} from "@/plugins/markdownArtifacts";
import { codePreviewExtension } from "@/plugins/codePreview/tiptap";
import { blockImageExtension } from "@/plugins/blockImage/tiptap";
import { imageViewExtension } from "@/plugins/imageView/tiptap";
import { CJKLetterSpacing } from "@/plugins/cjkLetterSpacing";
import { tocExtension } from "@/plugins/tableOfContents/tiptap";

/**
 * Creates a filtered array of Tiptap extensions for export rendering.
 *
 * This excludes all interactive extensions (popups, tooltips, search, etc.)
 * but keeps all content rendering extensions to ensure visual parity with
 * the WYSIWYG editor.
 *
 * Key extensions kept:
 * - codePreviewExtension: Renders Math (KaTeX) and Mermaid (SVG)
 * - All content nodes: headings, paragraphs, lists, tables, etc.
 * - All marks: bold, italic, highlight, underline, etc.
 * - Custom blocks: alerts, details, footnotes, wiki-links
 *
 * Extensions removed (interactive only):
 * - All popup extensions (link, image, math, footnote, wiki-link)
 * - All tooltip extensions
 * - Search extension
 * - Multi-cursor extension
 * - AI suggestion extension
 * - Focus/typewriter mode extensions
 * - Paste handling extensions (not needed for read-only)
 */
export function createExportExtensions(): Extensions {
  return [
    StarterKit.configure({
      // Disable nodes replaced with sourceLine-enabled versions
      listItem: false,
      underline: false,
      heading: false,
      paragraph: false,
      codeBlock: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      horizontalRule: false,
      link: false,
    }),
    // Custom Link extension (read-only, no click handling needed)
    Link.extend({
      excludes: "link code",
    }).configure({
      openOnClick: false,
      HTMLAttributes: {
        target: null,
        rel: null,
      },
    }),
    // Content nodes with sourceLine attribute
    HeadingWithSourceLine,
    ParagraphWithSourceLine,
    CodeBlockWithSourceLine,
    BlockquoteWithSourceLine,
    BulletListWithSourceLine,
    OrderedListWithSourceLine,
    HorizontalRuleWithSourceLine,
    // Task lists
    taskListItemExtension,
    // Marks
    highlightExtension,
    subscriptExtension,
    superscriptExtension,
    underlineExtension,
    // Math (inline) - block math handled by codePreviewExtension
    mathInlineExtension,
    // Custom blocks
    alertBlockExtension,
    detailsSummaryExtension,
    detailsBlockExtension,
    tocExtension,
    // Wiki links and markdown artifacts
    wikiLinkExtension,
    linkDefinitionExtension,
    frontmatterExtension,
    htmlInlineExtension,
    htmlBlockExtension,
    // Footnotes
    footnoteReferenceExtension,
    footnoteDefinitionExtension,
    // Tables
    TableWithScrollWrapper.configure({ resizable: false }),
    TableRowWithSourceLine,
    AlignedTableHeader,
    AlignedTableCell,
    // Images
    blockImageExtension,
    imageViewExtension,
    // Code preview (renders Math/Mermaid) - critical for export parity
    codePreviewExtension,
    // CJK spacing
    CJKLetterSpacing,
  ];
}
