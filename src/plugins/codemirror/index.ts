/**
 * CodeMirror Plugins
 *
 * Custom plugins and configuration for the Source mode editor.
 */

export { sourceEditorTheme, codeHighlightStyle } from "./theme";
export { createBrHidingPlugin } from "./brHidingPlugin";
export { createListBlankLinePlugin } from "./listBlankLinePlugin";
export { createMarkdownAutoPairPlugin, markdownPairBackspace } from "./markdownAutoPair";
export { tabEscapeKeymap } from "./tabEscape";
export { tabIndentFallbackKeymap, shiftTabIndentFallbackKeymap } from "./tabIndent";
export { listContinuationKeymap } from "./listContinuation";
export { tableTabKeymap, tableShiftTabKeymap, tableArrowUpKeymap, tableArrowDownKeymap } from "./tableTabNav";
export { createSmartPastePlugin } from "./smartPaste";
export { createSourceFocusModePlugin } from "./focusModePlugin";
export { createSourceTypewriterPlugin } from "./typewriterModePlugin";
export { createImeGuardPlugin } from "./imeGuard";
export { createSourceCursorContextPlugin } from "./sourceCursorContext";
export { createSourceMathPreviewPlugin } from "./sourceMathPreview";
export { createSourceImagePreviewPlugin } from "./sourceImagePreview";
export { sourceMultiCursorExtensions } from "./sourceMultiCursorPlugin";
export { sourceSpellCheckExtensions } from "./sourceSpellCheck";
export { sourceTableContextMenuExtensions } from "./sourceTableContextMenu";
export { sourceTableCellHighlightExtensions } from "./sourceTableCellHighlight";
export { sourceMermaidPreviewExtensions } from "./sourceMermaidPreview";
export { sourceAlertDecorationExtensions } from "./sourceAlertDecoration";
export { sourceDetailsDecorationExtensions } from "./sourceDetailsDecoration";
