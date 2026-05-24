/**
 * Central plugin registration — ADR-011.
 *
 * Importing this module registers every plugin's manifest with the
 * registry. Consumers that want to enumerate the registered plugin set
 * (debug overlays, palette, dependency resolvers) import this first so
 * `listPlugins()` returns a non-empty snapshot.
 *
 * The existing `editorPlugins.tiptap.ts` continues to hand-compose
 * plugins into the Tiptap editor; switching it to consume the registry
 * is a follow-up that requires each manifest to expose its lazy
 * `tiptap()` / `codemirror()` factory.
 *
 * @module plugins/manifests
 */

import { registerPlugin } from "./registry";

import { manifest as aiSuggestion } from "./aiSuggestion/manifest";
import { manifest as alertBlock } from "./alertBlock/manifest";
import { manifest as autoPair } from "./autoPair/manifest";
import { manifest as blockAudio } from "./blockAudio/manifest";
import { manifest as blockEscape } from "./blockEscape/manifest";
import { manifest as blockImage } from "./blockImage/manifest";
import { manifest as blockquoteEscape } from "./blockquoteEscape/manifest";
import { manifest as blockVideo } from "./blockVideo/manifest";
import { manifest as cjkLetterSpacing } from "./cjkLetterSpacing/manifest";
import { manifest as codeBlockLineNumbers } from "./codeBlockLineNumbers/manifest";
import { manifest as codePaste } from "./codePaste/manifest";
import { manifest as codePreview } from "./codePreview/manifest";
import { manifest as compositionGuard } from "./compositionGuard/manifest";
import { manifest as detailsBlock } from "./detailsBlock/manifest";
import { manifest as focusMode } from "./focusMode/manifest";
import { manifest as footnotePopup } from "./footnotePopup/manifest";
import { manifest as formatToolbar } from "./formatToolbar/manifest";
import { manifest as frontmatterPanel } from "./frontmatterPanel/manifest";
import { manifest as ghaWorkflowPreview } from "./ghaWorkflowPreview/manifest";
import { manifest as highlight } from "./highlight/manifest";
import { manifest as htmlPaste } from "./htmlPaste/manifest";
import { manifest as imageHandler } from "./imageHandler/manifest";
import { manifest as imagePasteToast } from "./imagePasteToast/manifest";
import { manifest as imagePreview } from "./imagePreview/manifest";
import { manifest as imageView } from "./imageView/manifest";
import { manifest as inactiveSelection } from "./inactiveSelection/manifest";
import { manifest as inlineCodeBoundary } from "./inlineCodeBoundary/manifest";
import { manifest as inlineNodeEditing } from "./inlineNodeEditing/manifest";
import { manifest as latex } from "./latex/manifest";
import { manifest as linkCreatePopup } from "./linkCreatePopup/manifest";
import { manifest as linkPopup } from "./linkPopup/manifest";
import { manifest as lint } from "./lint/manifest";
import { manifest as listBackspace } from "./listBackspace/manifest";
import { manifest as listClickFix } from "./listClickFix/manifest";
import { manifest as listContinuation } from "./listContinuation/manifest";
import { manifest as listEscape } from "./listEscape/manifest";
import { manifest as markdownArtifacts } from "./markdownArtifacts/manifest";
import { manifest as markdownCopy } from "./markdownCopy/manifest";
import { manifest as markdownPaste } from "./markdownPaste/manifest";
import { manifest as markInputRules } from "./markInputRules/manifest";
import { manifest as markmap } from "./markmap/manifest";
import { manifest as mathPopup } from "./mathPopup/manifest";
import { manifest as mathPreview } from "./mathPreview/manifest";
import { manifest as mediaHandler } from "./mediaHandler/manifest";
import { manifest as mediaPopup } from "./mediaPopup/manifest";
import { manifest as mermaid } from "./mermaid/manifest";
import { manifest as mermaidPreview } from "./mermaidPreview/manifest";
import { manifest as multiCursor } from "./multiCursor/manifest";
import { manifest as search } from "./search/manifest";
import { manifest as smartPaste } from "./smartPaste/manifest";
import { manifest as smartSelectAll } from "./smartSelectAll/manifest";
import { manifest as sourceContextDetection } from "./sourceContextDetection/manifest";
import { manifest as sourceFootnotePopup } from "./sourceFootnotePopup/manifest";
import { manifest as sourceImagePopup } from "./sourceImagePopup/manifest";
import { manifest as sourceLinkCreatePopup } from "./sourceLinkCreatePopup/manifest";
import { manifest as sourceLinkPopup } from "./sourceLinkPopup/manifest";
import { manifest as sourceMathPopup } from "./sourceMathPopup/manifest";
import { manifest as sourcePeekInline } from "./sourcePeekInline/manifest";
import { manifest as sourcePopup } from "./sourcePopup/manifest";
import { manifest as sourceWikiLinkPopup } from "./sourceWikiLinkPopup/manifest";
import { manifest as subSuperscript } from "./subSuperscript/manifest";
import { manifest as svg } from "./svg/manifest";
import { manifest as syntaxReveal } from "./syntaxReveal/manifest";
import { manifest as tabIndent } from "./tabIndent/manifest";
import { manifest as tableOfContents } from "./tableOfContents/manifest";
import { manifest as tableScroll } from "./tableScroll/manifest";
import { manifest as tableUI } from "./tableUI/manifest";
import { manifest as taskToggle } from "./taskToggle/manifest";
import { manifest as textDragDrop } from "./textDragDrop/manifest";
import { manifest as toolbarContext } from "./toolbarContext/manifest";
import { manifest as typewriterMode } from "./typewriterMode/manifest";
import { manifest as underline } from "./underline/manifest";
import { manifest as videoEmbed } from "./videoEmbed/manifest";
import { manifest as wikiLinkPopup } from "./wikiLinkPopup/manifest";
import { manifest as workflowPreview } from "./workflowPreview/manifest";

const ALL = [
  aiSuggestion, alertBlock, autoPair, blockAudio, blockEscape, blockImage,
  blockquoteEscape, blockVideo, cjkLetterSpacing, codeBlockLineNumbers,
  codePaste, codePreview, compositionGuard, detailsBlock, focusMode,
  footnotePopup, formatToolbar, frontmatterPanel, ghaWorkflowPreview,
  highlight, htmlPaste, imageHandler, imagePasteToast, imagePreview,
  imageView, inactiveSelection, inlineCodeBoundary, inlineNodeEditing,
  latex, linkCreatePopup, linkPopup, lint, listBackspace, listClickFix,
  listContinuation, listEscape, markdownArtifacts, markdownCopy,
  markdownPaste, markInputRules, markmap, mathPopup, mathPreview,
  mediaHandler, mediaPopup, mermaid, mermaidPreview, multiCursor, search,
  smartPaste, smartSelectAll, sourceContextDetection, sourceFootnotePopup,
  sourceImagePopup, sourceLinkCreatePopup, sourceLinkPopup, sourceMathPopup,
  sourcePeekInline, sourcePopup, sourceWikiLinkPopup, subSuperscript, svg,
  syntaxReveal, tabIndent, tableOfContents, tableScroll, tableUI,
  taskToggle, textDragDrop, toolbarContext, typewriterMode, underline,
  videoEmbed, wikiLinkPopup, workflowPreview,
];

let registered = false;
export function registerAllPlugins(): void {
  if (registered) return;
  for (const m of ALL) registerPlugin(m);
  registered = true;
}
