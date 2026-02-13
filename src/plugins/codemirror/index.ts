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
export { tableTabKeymap, tableShiftTabKeymap, tableArrowUpKeymap, tableArrowDownKeymap, tableModEnterKeymap, tableModShiftEnterKeymap } from "./tableTabNav";
export { createSmartPastePlugin } from "./smartPaste";
export { createSourceFocusModePlugin } from "./focusModePlugin";
export { createSourceTypewriterPlugin } from "./typewriterModePlugin";
export { createImeGuardPlugin } from "./imeGuard";
export { createSourceCursorContextPlugin } from "./sourceCursorContext";
export { createSourceMathPreviewPlugin } from "./sourceMathPreview";
export { createSourceImagePreviewPlugin } from "./sourceImagePreview";
export { sourceMultiCursorExtensions } from "./sourceMultiCursorPlugin";
export { sourceTableContextMenuExtensions } from "./sourceTableContextMenu";
export { sourceTableCellHighlightExtensions } from "./sourceTableCellHighlight";
export { sourceDiagramPreviewExtensions } from "./sourceMermaidPreview";
export { sourceAlertDecorationExtensions } from "./sourceAlertDecoration";
export { sourceDetailsDecorationExtensions } from "./sourceDetailsDecoration";
export {
  visualLineUpKeymap,
  visualLineDownKeymap,
  visualLineUpSelectKeymap,
  visualLineDownSelectKeymap,
  smartHomeKeymap,
  smartHomeSelectKeymap,
} from "./visualLineNav";
export { structuralBackspaceKeymap, structuralDeleteKeymap } from "./structuralCharProtection";
export { listSmartIndentKeymap, listSmartOutdentKeymap } from "./listSmartIndent";
export { createSourceCopyOnSelectPlugin } from "./sourceCopyOnSelect";
