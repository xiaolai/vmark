/**
 * Canonical composition order for the two editor roots (WI-3.4, ADR-015 D1).
 *
 * Each list is the SINGLE place its root's extension order is declared. The
 * roots derive explicit `after` constraints from these lists
 * (`extensionOrdering.deriveAfterConstraints`), so the physical extension arrays
 * can be alphabetical (array position not load-bearing) while resolution still
 * reproduces exactly this order. `assertCanonicalCoverage` throws at composition
 * time if a list and its root's actual ids ever drift.
 *
 * @coordinates-with tiptapExtensions.ts — WYSIWYG root
 * @coordinates-with sourceEditorExtensions.ts — CodeMirror source root
 * @coordinates-with extensionOrdering.ts — turns these lists into constraints
 * @module services/assembly/compositionOrder
 */

/**
 * WYSIWYG extensions, keyed by each extension's Tiptap `name`. `markdownLint` is
 * the one OPTIONAL entry (registered only with a tabId; it is terminal, so
 * nothing chains after it).
 */
export const WYSIWYG_COMPOSITION_ORDER: readonly string[] = [
  "starterKit",
  "link",
  "bold",
  "italic",
  "heading",
  "paragraph",
  "codeBlock",
  "blockquote",
  "bulletList",
  "orderedList",
  "horizontalRule",
  "listItem",
  "highlight",
  "subscript",
  "superscript",
  "underline",
  "math_inline",
  "mathPopup",
  "alertBlock",
  "detailsSummary",
  "detailsBlock",
  "toc",
  "wikiLink",
  "link_definition",
  "frontmatter",
  "html_inline",
  "html_block",
  "wikiLinkPopup",
  "footnote_reference",
  "footnote_definition",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "tableUI",
  "tableScrollFreeze",
  "editorContextMenu",
  "blockEscape",
  "compositionGuard",
  "block_image",
  "block_video",
  "block_audio",
  "video_embed",
  "image",
  "inlineNodeEditing",
  "footnotePopup",
  "smartPaste",
  "markdownPaste",
  "htmlPaste",
  "codePaste",
  "markdownCopy",
  "linkPopup",
  "linkCreatePopup",
  "search",
  "autoPair",
  "focusMode",
  "typewriterMode",
  "blankLinesGuard",
  "imageHandler",
  "mediaHandler",
  "mediaPopup",
  "codePreview",
  "blockMathKeymap",
  "listContinuation",
  "listBackspace",
  "listClickFix",
  "editorKeymaps",
  "tabIndent",
  "multiCursor",
  "aiSuggestion",
  "cjkLetterSpacing",
  "sourcePeekInline",
  "smartSelectAll",
  "inlineCodeBoundary",
  "textDragDrop",
  "inactiveSelection",
  "showInvisibles",
  "markdownLint",
];

/** The only optional WYSIWYG entry — present only when a tabId is supplied. */
export const WYSIWYG_OPTIONAL_IDS: readonly string[] = ["markdownLint"];

/**
 * Source-editor (CodeMirror) extensions, keyed by their `source.*` id. Every
 * entry is always registered (conditional ones supply an empty extension, not an
 * absent descriptor), so this root has no optional ids.
 */
export const SOURCE_COMPOSITION_ORDER: readonly string[] = [
  "source.lineWrapCompartment",
  "source.brVisibilityCompartment",
  "source.showInvisiblesCompartment",
  "source.autoPairCompartment",
  "source.lineNumbersCompartment",
  "source.markdownCloseBrackets",
  "source.markdownAutoPairPlugin",
  "source.listBlankLinePlugin",
  "source.smartPastePlugin",
  "source.sourceCopyOnSelectPlugin",
  "source.imeGuardPlugin",
  "source.imeScrollGuard",
  "source.sourceFocusModePlugin",
  "source.sourceTypewriterPlugin",
  "source.drawSelection",
  "source.dropCursor",
  "source.multiCursorExtensions",
  "source.editorState",
  "source.inactiveSelectionExtensions",
  "source.history",
  "source.shortcutKeymapCompartment",
  "source.readOnlyCompartment",
  "source.keymap",
  "source.search",
  "source.language",
  "source.workflowPreview",
  "source.yamlLint",
  "source.workflowCompletion",
  "source.workflowCursorSync",
  "source.gotoExtension",
  "source.syntaxHighlighting",
  "source.updateListener",
  "source.editorTheme",
  "source.sourceCursorContextPlugin",
  "source.sourceMathPreviewPlugin",
  "source.sourceImagePreviewPlugin",
  "source.sourceImagePopupPlugin",
  "source.sourceLinkPopupPlugin",
  "source.sourceLinkCreatePopupPlugin",
  "source.sourceWikiLinkPopupPlugin",
  "source.sourceFootnotePopupPlugin",
  "source.tableContextMenuExtensions",
  "source.editorContextMenuExtension",
  "source.tableCellHighlightExtensions",
  "source.diagramPreviewExtensions",
  "source.alertDecorationExtensions",
  "source.detailsDecorationExtensions",
  "source.mediaDecorationExtensions",
  "source.lint",
];
