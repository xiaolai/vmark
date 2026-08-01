/**
 * Tiptap Extensions Configuration
 *
 * Purpose: Assembles the Tiptap extension stack — StarterKit overrides, marks,
 * nodes, media, plugins. Settings reach a plugin as an injected getter (ADR-015).
 *
 * Key decisions:
 *   - StarterKit is the base, with several nodes overridden (heading, paragraph,
 *     codeBlock, etc.) to add sourceLine attributes; loaded eagerly (WYSIWYG is
 *     the default mode)
 *   - Link uses openOnClick:false (custom popups); Bold/Italic replaced with
 *     CJK-aware versions; custom marks (highlight, underline, sub/superscript)
 *   - Media extensions (block_video, block_audio, video_embed) with NodeViews,
 *     plus media popup/handler extensions; tocExtension for [TOC] navigation
 *   - Composition order is pinned via WYSIWYG_COMPOSITION_ORDER (WI-3.4)
 *
 * The Link mark lives in `linkExtension.ts` with its round-trip attributes.
 *
 * @coordinates-with sourceEditorExtensions.ts — parallel config for CodeMirror source mode
 * @coordinates-with markdownPipeline/ — schema nodes must match pipeline converters
 * @coordinates-with editorPlugins.tiptap.ts — additional ProseMirror plugins
 * @module utils/tiptapExtensions
 */

import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { vmarkLinkExtension } from "./linkExtension";
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
import { showInvisiblesExtension } from "@/plugins/showInvisibles/tiptap";
import { linkPopupExtension } from "@/plugins/linkPopup/tiptap";
import { linkCreatePopupExtension } from "@/plugins/linkCreatePopup";
import { inlineNodeEditingExtension } from "@/plugins/inlineNodeEditing/tiptap";
import { searchExtension } from "@/plugins/search/tiptap";
import { autoPairExtension } from "@/plugins/autoPair/tiptap";
import { currentAutoPairConfig } from "./autoPairConfig";
import { useSettingsStore } from "@/stores/settingsStore";
import { compositionGuardExtension } from "@/plugins/compositionGuard/tiptap";
import { blankLinesGuardExtension } from "@/plugins/blankLinesGuard/tiptap";
import { focusModeExtension } from "@/plugins/focusMode/tiptap";
import { focusModeHostOptions, typewriterModeHostOptions } from "./uiToggleOptions";
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
import { editorContextMenuExtension } from "@/plugins/editorContextMenu/tiptap";
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
import { inactiveSelectionExtension } from "@/plugins/inactiveSelection/tiptap";
import { resolveExtensions } from "@/lib/extensions/resolve";
import { deriveAfterConstraints, assertCanonicalCoverage } from "./extensionOrdering";
import { WYSIWYG_COMPOSITION_ORDER, WYSIWYG_OPTIONAL_IDS } from "./compositionOrder";
import type { VMarkExtension } from "@/lib/extensions/types";

export interface TiptapExtensionConfig {
  /** Tab ID for lint diagnostics (lint extension is registered when present) */
  tabId?: string;
}

/**
 * The extension list. Not the composition path — `createTiptapExtensions` routes
 * it through the resolver (ADR-015 D1). WI-3.4: array position is not load-bearing
 * — order is declared once in `WYSIWYG_COMPOSITION_ORDER` and pinned via explicit
 * `after` constraints, so this list is sorted alphabetically before composition
 * yet resolves to the canonical order. Kept in logical/grouped order here for
 * readability; the sort + constraints make its physical order cosmetic.
 */
function buildExtensionList(config: TiptapExtensionConfig = {}): Extensions {
  const { tabId } = config;
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
    vmarkLinkExtension,
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
    editorContextMenuExtension,
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
    autoPairExtension.configure({ getConfig: currentAutoPairConfig }), // see autoPairConfig.ts
    focusModeExtension.configure(focusModeHostOptions),
    typewriterModeExtension.configure(typewriterModeHostOptions),
    blankLinesGuardExtension,
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
    tabIndentExtension.configure({
      getTabSize: () => useSettingsStore.getState().general.tabSize,
    }),
    multiCursorExtension,
    aiSuggestionExtension,
    CJKLetterSpacing,
    sourcePeekInlineExtension,
    smartSelectAllExtension,
    inlineCodeBoundaryExtension,
    textDragDropExtension,
    inactiveSelectionExtension,
    // Show-invisibles decorations (toggle via storage.enabled).
    showInvisiblesExtension,
    // Lint decorations (block-level, WYSIWYG only). Always registered when a
    // tab is known — the plugin gates decoration building on the LIVE
    // markdown.lintEnabled setting, so toggling lint takes effect without an
    // editor remount (mount-time gating left WYSIWYG stale until remount).
    ...(tabId ? [LintExtension.configure({ tabId })] : []),
  ];
}

/**
 * Creates the array of Tiptap extensions for the WYSIWYG editor. Composition
 * goes through `resolveExtensions` (ADR-015 D1): the registry IS the composition,
 * so no second representation can drift from it.
 *
 * Each Tiptap extension becomes a descriptor keyed by its own `name` (unique
 * across all 78). Order is pinned by explicit `after` constraints derived from
 * `WYSIWYG_COMPOSITION_ORDER` (WI-3.4), so the descriptors are sorted
 * alphabetically before resolution and the resolver reproduces the canonical
 * order regardless of array position. Resolution errors throw rather than
 * silently dropping an extension — a missing editor extension is a broken editor.
 */
export function createTiptapExtensions(config: TiptapExtensionConfig = {}): Extensions {
  const list = buildExtensionList(config);
  const presentIds = list.map((extension, index) => extension.name || `anonymous-${index}`);

  // Fail loud if an extension was added/removed without updating the canonical
  // order (WI-3.4), then pin each present entry after its canonical predecessor.
  assertCanonicalCoverage("wysiwyg", WYSIWYG_COMPOSITION_ORDER, presentIds, WYSIWYG_OPTIONAL_IDS);
  const after = deriveAfterConstraints(WYSIWYG_COMPOSITION_ORDER, presentIds);

  const descriptors: VMarkExtension[] = list
    .map((extension, index): VMarkExtension => {
      const id = extension.name || `anonymous-${index}`;
      return {
        id,
        contributions: [{ kind: "tiptap", factory: () => extension }],
        ordering: after.has(id) ? { after: after.get(id) } : undefined,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const { ordered, errors } = resolveExtensions(descriptors);
  if (errors.length > 0) {
    throw new Error(
      `Editor extension composition failed:\n${errors
        .map((error) => `  - [${error.code}] ${error.message}`)
        .join("\n")}`,
    );
  }

  return ordered.map(
    (descriptor) =>
      (descriptor.contributions[0] as { factory: () => Extensions[number] }).factory(),
  );
}
